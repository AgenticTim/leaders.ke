// Platform-scope retrieval router (plans/10-platform-wide-ai-chat.md): the
// site-wide Ask box answers any civic or platform question, so unlike the
// per-leader chat (one fixed knowledgebase per profile) it must first work out
// WHICH of the platform's own sources the question needs, then pull only those
// into the answer prompt.
//
// Routing is keyword/intent matching, not an AI call: the categories are
// distinct enough in vocabulary ("who is my MP" vs "what does an MCA earn" vs
// "what does a campaign page cost") that a classifier round trip would add
// latency and cost for no accuracy gain. Several sources can match one
// question — they're all included rather than picking a single winner, since
// the answering model is better placed to decide what's relevant than a
// keyword rule is.
import { and, desc, eq, ilike, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, leaders, positions, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, leaderPath } from '$lib/server/leader';
import { counties } from '$lib/data/geo';
import { SEAT_DUTIES_BY_TITLE } from '$lib/data/seatDuties';
import { CENSUS_YEAR, DEMOGRAPHICS_SOURCE, NATIONAL, genZEligible2027, votingAge2027 } from '$lib/data/demographics';
import { listCurrentPricing, listPackages } from '$lib/server/packages';
import { getPlatformSettings } from '$lib/server/settings';

/** The viewer's saved location (users.county/constituency/ward), so "who is my
 * MP" resolves without asking them to repeat it. All null for a guest. */
export type AskerLocation = { county: string | null; constituency: string | null; ward: string | null };

/** One retrieved block: `label` names the source in the prompt so the model can
 * attribute, `text` is the material itself. */
type Source = { label: string; text: string };

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

// ── Directory: who holds / is running for a seat ────────────────────────────

/** Seat titles named in the question, plus the ones implied by a "my <seat>"
 * phrasing, so the directory lookup can filter to what was actually asked
 * rather than dumping every seat in a region. */
function titlesIn(q: string): string[] {
	const titles: string[] = [];
	if (has(q, 'president')) titles.push('President');
	if (has(q, 'governor')) titles.push('Governor');
	if (has(q, 'senator', 'senate')) titles.push('Senator');
	if (has(q, 'woman rep', 'women rep', 'woman representative')) titles.push('Woman Rep');
	if (has(q, 'mca', 'ward rep')) titles.push('MCA');
	// "MP" last and word-boundaried: "mp" appears inside other words often enough
	// that a bare includes() would match half the corpus.
	if (/\bmps?\b|member of parliament/.test(q)) titles.push('MP');
	return titles;
}

/** Region names (county/constituency/ward) mentioned literally in the question,
 * e.g. "governor of Meru". Longest-first so "Nairobi West" wins over "Nairobi". */
function regionsIn(q: string): string[] {
	const names: string[] = [];
	for (const county of counties) {
		if (q.includes(county.name.toLowerCase())) names.push(county.name);
		for (const constituency of county.constituencies) {
			if (q.includes(constituency.name.toLowerCase())) names.push(constituency.name);
			for (const ward of constituency.wards) {
				if (q.includes(ward.name.toLowerCase())) names.push(ward.name);
			}
		}
	}
	return [...new Set(names)].sort((a, b) => b.length - a.length).slice(0, 4);
}

/** Current holders and 2027 aspirants for the seats/regions the question points
 * at — the question's own region names, else the asker's saved location. Only
 * publicly visible people (a verified term or verified run), the same gate the
 * rest of the site uses. */
async function directorySource(q: string, location: AskerLocation): Promise<Source | null> {
	const titles = titlesIn(q);
	const askedRegions = regionsIn(q);
	// "my MP" / "my governor" and bare "who is" questions fall back to whatever
	// location the citizen saved on their account.
	const myRegions = [location.ward, location.constituency, location.county].filter((r): r is string => !!r);
	const regions = askedRegions.length > 0 ? askedRegions : myRegions;
	if (titles.length === 0 && regions.length === 0) return null;

	const regionFilter = regions.length > 0 ? or(...regions.map((r) => ilike(positions.region, r))) : undefined;
	const titleFilter = titles.length > 0 ? or(...titles.map((t) => eq(positions.title, t))) : undefined;
	// A national seat is relevant to everyone, so it rides along whenever the
	// question named a national title (President) without naming a region.
	const where = [regionFilter, titleFilter].filter(Boolean);
	if (where.length === 0) return null;

	const [heldRows, runRows] = await Promise.all([
		db
			.select({
				firstName: users.firstName,
				otherNames: users.otherNames,
				slug: users.slug,
				title: positions.title,
				region: positions.region,
				// 'current' vs 'former': a seat has one sitting holder and many past
				// ones, and answering "who is the governor of X" with a list that
				// silently mixes them is exactly the misinformation this platform
				// exists to avoid. Sitting holders sort first and are labelled.
				status: leaders.status,
				startAt: leaders.startAt,
				endAt: leaders.endAt
			})
			.from(leaders)
			.innerJoin(positions, eq(leaders.positionId, positions.id))
			.innerJoin(users, eq(users.id, leaders.userId))
			.where(and(isNull(leaders.deletedAt), isNotNull(leaders.verifiedAt), isNull(users.deletedAt), ...where))
			.orderBy(desc(leaders.startAt))
			.limit(25),
		db
			.select({ firstName: users.firstName, otherNames: users.otherNames, slug: users.slug, title: positions.title, region: positions.region })
			.from(campaigns)
			.innerJoin(positions, eq(campaigns.positionId, positions.id))
			.innerJoin(users, eq(users.id, campaigns.subjectUserId))
			.where(
				and(
					isNull(campaigns.deletedAt),
					isNotNull(campaigns.verifiedAt),
					eq(campaigns.cycleYear, ACTIVE_CYCLE),
					isNull(users.deletedAt),
					...where
				)
			)
			.limit(25)
	]);

	if (heldRows.length === 0 && runRows.length === 0) return null;
	const year = (d: Date | null) => (d ? String(d.getFullYear()) : '');
	const profile = (r: { slug: string | null }) => (r.slug ? ` (profile: ${leaderPath(r)})` : '');
	const termLine = (r: (typeof heldRows)[number]) =>
		`- ${fullName(r)} — ${r.title}, ${r.region}, ${year(r.startAt)}${r.endAt ? `-${year(r.endAt)}` : '-present'}${profile(r)}`;

	const sitting = heldRows.filter((r) => r.status === 'current');
	const past = heldRows.filter((r) => r.status !== 'current');

	const text = [
		regions.length > 0 ? `Region(s) in scope: ${regions.join(', ')}.` : '',
		askedRegions.length === 0 && myRegions.length > 0
			? "(Resolved from the citizen's own saved location on their vote.ke account.)"
			: '',
		sitting.length > 0
			? `CURRENTLY IN OFFICE (this is the answer to "who is the <seat>" questions):\n${sitting.map(termLine).join('\n')}`
			: '',
		past.length > 0 ? `FORMER holders of these seats (past terms — do NOT present as current):\n${past.map(termLine).join('\n')}` : '',
		runRows.length > 0
			? `Declared ${ACTIVE_CYCLE} candidates (running, not yet elected):\n${runRows.map((r) => `- ${fullName(r)} — ${r.title}, ${r.region}${profile(r)}`).join('\n')}`
			: ''
	]
		.filter(Boolean)
		.join('\n');
	return { label: 'vote.ke leader directory (verified profiles)', text };
}

// ── Civics: what a seat actually does ───────────────────────────────────────

/** Constitutional job description for any seat the question names, straight
 * from seatDuties.ts (which carries kenyalaw.org deep links per duty group, so
 * the model can cite the actual article). */
function seatDutiesSource(q: string): Source | null {
	const titles = titlesIn(q);
	const wantsDuties = has(q, 'do', 'does', 'duty', 'duties', 'role', 'job', 'responsib', 'mandate', 'supposed to');
	if (titles.length === 0 || !wantsDuties) return null;

	const blocks = titles
		.map((title) => {
			const duties = SEAT_DUTIES_BY_TITLE[title];
			if (!duties) return '';
			const groups = duties.groups
				.map((g) => `${g.heading} (${g.sourceLabel} — ${g.sourceUrl}):\n${g.items.map((i) => `  - ${i}`).join('\n')}`)
				.join('\n');
			return `${title}: ${duties.summary}\n${groups}`;
		})
		.filter(Boolean);
	if (blocks.length === 0) return null;
	return { label: 'Constitution of Kenya — seat duties', text: blocks.join('\n\n') };
}

// ── Stats: the census/register figures behind /demographics ─────────────────

function demographicsSource(q: string): Source | null {
	if (!has(q, 'gen-z', 'gen z', 'genz', 'young', 'youth', 'population', 'how many', 'voting age', 'demograph', 'millennial')) return null;
	const text = [
		`Source: ${DEMOGRAPHICS_SOURCE} (${CENSUS_YEAR} census), projected to ${ACTIVE_CYCLE}.`,
		`National population at the ${CENSUS_YEAR} census: ${NATIONAL.total.toLocaleString()}.`,
		`Estimated voting-age (18+) population in ${ACTIVE_CYCLE}: ${votingAge2027(NATIONAL.bands).toLocaleString()}.`,
		`Estimated gen-z (born 1997-2012) who will be eligible to vote in ${ACTIVE_CYCLE}: ${genZEligible2027(NATIONAL.bands).toLocaleString()}.`,
		'Per-county breakdowns and ward-level estimates are on the /demographics page.'
	].join('\n');
	return { label: 'KNBS census + 2027 cohort projections (vote.ke /demographics)', text };
}

// ── Pricing: what a campaign pays (single source of truth) ──────────────────

async function pricingSource(q: string): Promise<Source | null> {
	if (!has(q, 'cost', 'price', 'pricing', 'pay', 'fee', 'charge', 'subscription', 'package', 'plan', 'credit', 'how much')) return null;
	const [rates, packages, settings] = await Promise.all([listCurrentPricing(), listPackages(), getPlatformSettings()]);
	const rateLines = rates.map((r) => `- ${r.tier} (${r.billingCycle}): KES ${r.amount.toLocaleString()}`).join('\n');
	const packageLines = packages
		.map((p) => `- ${p.tier}: ${Object.entries(p.features ?? {}).map(([k, v]) => `${k}=${v === null ? 'unlimited' : v}`).join(', ')}`)
		.join('\n');
	const text = [
		`Campaign package rates (same price for every office):\n${rateLines}`,
		`What each package includes:\n${packageLines}`,
		`Pay-as-you-go credit costs: AI chat answer ${settings.aiChatCostCredits} credits, SMS ${settings.smsCostCredits}, WhatsApp ${settings.whatsappCostCredits}.`,
		'Full comparison table: /pricing'
	].join('\n\n');
	return { label: 'vote.ke live pricing', text };
}

// ── Platform how-to: what a citizen/leader can DO here ──────────────────────

// Short, stable descriptions of the platform's own flows — these are facts
// about vote.ke itself (which route does what), not content that changes, so
// they live here rather than in an admin-editable corpus for now.
const HOW_TO: { keys: string[]; label: string; text: string }[] = [
	{
		keys: ['ballot', 'booth', 'simulat', 'practice vote'],
		label: 'Ballot simulator',
		text: 'Citizens can build a practice 2027 ballot at / (the homepage booth), picking a candidate for each of the six seats they will vote for. It saves to their account (or their device if signed out) and can be revisited from /dashboard/my-vote.'
	},
	{
		keys: ['pledge', 'support a candidate', 'back a candidate'],
		label: 'Vote pledges',
		text: "A citizen pledges their vote to a candidate from that candidate's own profile page. Pledges are private to the campaign's dashboard and are a signal of support, not a binding or official vote."
	},
	{
		keys: ['ambassador', 'volunteer', 'work for', 'get a job', 'mobiliz'],
		label: 'Campaign ambassadors',
		text: 'Campaign ambassadors mobilize citizens on the ground for a candidate. A campaign invites its own ambassadors from its dashboard Team tab — vote.ke does not hire or pay ambassadors directly, so someone wanting the role should contact the campaign they want to work for (every verified profile has contact details and a follow button).'
	},
	{
		keys: ['claim', 'my profile', 'running for', 'i am a candidate', 'aspirant', 'onboard', 'sign up as'],
		label: 'Claiming or creating a leader profile',
		text: 'Someone running for office (or their team) starts at /onboard/profile: search for an existing seeded profile to claim, or create a new one. A claim is reviewed by platform admins before the profile is verified and its campaign goes live.'
	},
	{
		keys: ['register', 'registration', 'iebc', 'am i registered', 'voter card'],
		label: 'Voter registration',
		text: 'vote.ke links citizens to the IEBC for the official register — see /verify-registration to check registration status and /drives for upcoming registration drives. vote.ke itself does not hold or update the IEBC register.'
	},
	{
		keys: ['election date', 'when is the', 'key date', 'nomination', 'poll day'],
		label: 'Key election dates',
		text: 'The 2027 general election timeline (nominations, campaign period, poll day) is tracked on /dates.'
	},
	{
		keys: ['follow', 'updates', 'newsletter'],
		label: 'Following leaders',
		text: 'Following a leader from their profile sends their campaign updates to the citizen, and lets the campaign reach them with broadcasts. News about followed leaders is aggregated on /news.'
	},
	{
		keys: ['donat', 'fundrais', 'contribut'],
		label: 'Donations',
		text: 'Campaigns can raise money on vote.ke; the platform charges a percentage fee on donations received. Exact current rates are on /pricing.'
	},
	{
		keys: ['compare', 'versus', ' vs '],
		label: 'Comparing leaders',
		text: 'Two leaders can be compared side by side at /compare — profile, manifesto pillars and delivery record together.'
	},
	{
		keys: ['rank', 'rating', 'review', 'score'],
		label: 'Ranks and reviews',
		text: 'Leaders are ranked by citizen reviews at /rank/presidents (and the equivalent page per seat). Any signed-in citizen can leave one review per leader.'
	}
];

function howToSource(q: string): Source | null {
	const hits = HOW_TO.filter((h) => has(q, ...h.keys));
	if (hits.length === 0) return null;
	return {
		label: 'How vote.ke works',
		text: hits.map((h) => `${h.label}: ${h.text}`).join('\n\n')
	};
}

// ── The router ─────────────────────────────────────────────────────────────

export type PlatformGrounding = { sources: Source[]; usedSavedLocation: boolean };

/** Picks and pulls every source the question plausibly needs. Returns an empty
 * list when nothing matches — the caller still answers (the model falls back on
 * the platform system prompt's "say you don't know, suggest a next step"
 * instruction) rather than dead-ending the citizen. */
export async function routePlatformQuestion(
	question: string,
	location: AskerLocation,
	recentQuestions: string[] = []
): Promise<PlatformGrounding> {
	// Routing reads the recent questions too, not just this one: a follow-up
	// ("when did he take office?") names no seat or region, so on its own it
	// matches no source and the answer would have conversation context but no
	// DATA to answer from. Only the citizen's own prior QUESTIONS are included —
	// past answers are long and would trigger sources by incidental mentions
	// (an answer that links /pricing shouldn't pull the pricing table next turn).
	const q = [...recentQuestions, question].join(' \n ').toLowerCase();
	const [directory, pricing] = await Promise.all([directorySource(q, location), pricingSource(q)]);
	const sources = [directory, seatDutiesSource(q), demographicsSource(q), pricing, howToSource(q)].filter(
		(s): s is Source => s !== null
	);
	const askedForRegion = regionsIn(q).length > 0;
	const usedSavedLocation = !!directory && !askedForRegion && !!(location.county || location.constituency || location.ward);
	return { sources, usedSavedLocation };
}

/** The retrieved sources as one grounding block for the answer prompt, capped
 * by the same admin-tunable per-question budget the leader chat uses. */
export function platformGroundingText(grounding: PlatformGrounding, maxChars: number): string {
	if (grounding.sources.length === 0) {
		return 'No platform data matched this question. Say plainly that vote.ke does not cover it yet, and point the citizen somewhere useful on the site if you can.';
	}
	return grounding.sources
		.map((s) => `--- ${s.label} ---\n${s.text}`)
		.join('\n\n')
		.slice(0, maxChars);
}
