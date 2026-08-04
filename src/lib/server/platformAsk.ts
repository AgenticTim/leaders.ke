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
// question. They're all included rather than picking a single winner, since
// the answering model is better placed to decide what's relevant than a
// keyword rule is.
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, followers, leaders, platformDocuments, platformFaqs, pledges, positions, posts, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, leaderPath } from '$lib/server/leader';
import { counties } from '$lib/data/geo';
import { SEAT_DUTIES_BY_TITLE } from '$lib/data/seatDuties';
import { CENSUS_YEAR, DEMOGRAPHICS_SOURCE, NATIONAL, genZEligible2027, votingAge2027 } from '$lib/data/demographics';
import { listCurrentPricing, listPackages } from '$lib/server/packages';
import { getPlatformSettings } from '$lib/server/settings';

/** Who's asking: their saved location (users.county/constituency/ward) so "who
 * is my MP" resolves without repeating it, and their account id so "my leaders"
 * can mean the ones they actually follow. All null/absent for a guest. */
export type AskerLocation = {
	userId?: number | null;
	county: string | null;
	constituency: string | null;
	ward: string | null;
};

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
 * at. The question's own region names, else the asker's saved location. Only
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
		`- ${fullName(r)}, ${r.title}, ${r.region}, ${year(r.startAt)}${r.endAt ? `-${year(r.endAt)}` : '-present'}${profile(r)}`;

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
		past.length > 0 ? `FORMER holders of these seats (past terms, do NOT present as current):\n${past.map(termLine).join('\n')}` : '',
		runRows.length > 0
			? `Declared ${ACTIVE_CYCLE} candidates (running, not yet elected):\n${runRows.map((r) => `- ${fullName(r)}, ${r.title}, ${r.region}${profile(r)}`).join('\n')}`
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
				.map((g) => `${g.heading} (${g.sourceLabel}, ${g.sourceUrl}):\n${g.items.map((i) => `  - ${i}`).join('\n')}`)
				.join('\n');
			return `${title}: ${duties.summary}\n${groups}`;
		})
		.filter(Boolean);
	if (blocks.length === 0) return null;
	return { label: 'Constitution of Kenya, seat duties', text: blocks.join('\n\n') };
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

// Short, stable descriptions of the platform's own flows. These are facts
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
		text: 'Campaign ambassadors mobilize citizens on the ground for a candidate. A campaign invites its own ambassadors from its dashboard Team tab, vote.ke does not hire or pay ambassadors directly, so someone wanting the role should contact the campaign they want to work for (every verified profile has contact details and a follow button).'
	},
	{
		keys: ['claim', 'my profile', 'running for', 'i am a candidate', 'aspirant', 'onboard', 'sign up as'],
		label: 'Claiming or creating a leader profile',
		text: 'Someone running for office (or their team) starts at /onboard/profile: search for an existing seeded profile to claim, or create a new one. A claim is reviewed by platform admins before the profile is verified and its campaign goes live.'
	},
	{
		keys: ['register', 'registration', 'iebc', 'am i registered', 'voter card'],
		label: 'Voter registration',
		text: 'vote.ke links citizens to the IEBC for the official register, see /verify-registration to check registration status and /drives for upcoming registration drives. vote.ke itself does not hold or update the IEBC register.'
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
		text: 'Two leaders can be compared side by side at /compare, profile, manifesto pillars and delivery record together.'
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

// ── Activity digest: what the citizen's own leaders have been doing ────────

const DIGEST_DAYS = 7;

/** Recent activity for the leaders this citizen actually follows — their posts
 * and news mentions from the last week. Falls back to the leaders of their saved
 * location when they follow nobody, so "what have my leaders done this week?"
 * still answers for a citizen who has only set a county. */
async function activityDigestSource(q: string, asker: AskerLocation): Promise<Source | null> {
	if (!has(q, 'my leader', 'this week', 'lately', 'recently', 'been doing', 'been up to', 'latest', 'update')) return null;

	let personIds: number[] = [];
	let basis = '';
	if (asker.userId) {
		const followed = await db
			.select({ id: followers.digestId })
			.from(followers)
			.where(and(eq(followers.userId, asker.userId), eq(followers.digest, 'leader'), isNull(followers.deletedAt)));
		// digestId is nullable on the table (a follow can target a non-leader
		// digest), so null rows are dropped rather than cast away.
		personIds = followed.map((f) => f.id).filter((id): id is number => id !== null);
		basis = 'the leaders this citizen follows';
	}
	// No follows: fall back to whoever holds a seat covering their saved location.
	if (personIds.length === 0) {
		const regions = [asker.ward, asker.constituency, asker.county].filter((r): r is string => !!r);
		if (regions.length === 0) return null;
		const rows = await db
			.select({ id: leaders.userId })
			.from(leaders)
			.innerJoin(positions, eq(leaders.positionId, positions.id))
			.where(
				and(
					isNull(leaders.deletedAt),
					isNotNull(leaders.verifiedAt),
					eq(leaders.status, 'current'),
					or(...regions.map((r) => ilike(positions.region, r)))
				)
			);
		personIds = [...new Set(rows.map((r) => r.id))];
		basis = `the sitting leaders for this citizen's saved location (${regions.join(', ')})`;
	}
	if (personIds.length === 0) return null;

	const since = new Date(Date.now() - DIGEST_DAYS * 24 * 60 * 60 * 1000);
	const rows = await db
		.select({
			firstName: users.firstName,
			otherNames: users.otherNames,
			slug: users.slug,
			title: posts.title,
			createdAt: posts.createdAt,
			// A team-authored update reads differently from press coverage we merely
			// ingested, so the answer can attribute each correctly.
			teamAuthored: sql<boolean>`${posts.creatorId} is not null`
		})
		.from(posts)
		.innerJoin(users, eq(users.id, posts.subjectUserId))
		.where(and(inArray(posts.subjectUserId, personIds), gte(posts.createdAt, since), isNull(posts.deletedAt), eq(posts.public, true)))
		.orderBy(desc(posts.createdAt))
		.limit(30);

	if (rows.length === 0) {
		return {
			label: `Activity digest (last ${DIGEST_DAYS} days)`,
			text: `Nothing published in the last ${DIGEST_DAYS} days by ${basis}. Say so plainly rather than reaching further back.`
		};
	}

	const lines = rows.map(
		(r) => `- ${fullName(r)}${r.slug ? ` (${leaderPath(r)})` : ''}: "${r.title}" — ${r.teamAuthored ? 'their own update' : 'press mention'}, ${r.createdAt.toDateString()}`
	);
	return {
		label: `Activity digest — last ${DIGEST_DAYS} days, for ${basis}`,
		text: lines.join('\n')
	};
}

// ── Race metrics: platform engagement, explicitly NOT a poll ────────────────

/** Follower/pledge/ballot-pick counts per candidate for a seat. This is the one
 * source that can be actively misread, so the disclaimer is part of the text
 * itself rather than left to the model's discretion — these are counts of
 * activity ON vote.ke by self-selected users, not a representative sample. */
async function raceMetricsSource(q: string): Promise<Source | null> {
	if (!has(q, 'leading', 'winning', 'ahead', 'popular', 'front-runner', 'frontrunner', 'who will win', 'poll')) return null;
	const titles = titlesIn(q);
	const title = titles[0] ?? 'President';

	const runs = await db
		.select({ subjectId: campaigns.subjectUserId, firstName: users.firstName, otherNames: users.otherNames, slug: users.slug, region: positions.region })
		.from(campaigns)
		.innerJoin(positions, eq(campaigns.positionId, positions.id))
		.innerJoin(users, eq(users.id, campaigns.subjectUserId))
		.where(
			and(
				isNull(campaigns.deletedAt),
				isNotNull(campaigns.verifiedAt),
				eq(campaigns.cycleYear, ACTIVE_CYCLE),
				eq(positions.title, title),
				isNull(users.deletedAt)
			)
		)
		.limit(30);
	if (runs.length === 0) return null;

	const ids = runs.map((r) => r.subjectId).filter((id): id is number => id !== null);
	if (ids.length === 0) return null;

	const [followerRows, pledgeRows] = await Promise.all([
		db
			.select({ id: followers.digestId, n: count() })
			.from(followers)
			.where(and(eq(followers.digest, 'leader'), inArray(followers.digestId, ids), isNull(followers.deletedAt)))
			.groupBy(followers.digestId),
		db
			.select({ id: campaigns.subjectUserId, n: count() })
			.from(pledges)
			.innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
			.where(and(inArray(campaigns.subjectUserId, ids), isNull(pledges.deletedAt)))
			.groupBy(campaigns.subjectUserId)
	]);
	const followersBy = new Map(followerRows.map((r) => [r.id, r.n]));
	const pledgesBy = new Map(pledgeRows.map((r) => [r.id, r.n]));

	const ranked = runs
		.map((r) => ({ ...r, followers: followersBy.get(r.subjectId!) ?? 0, pledges: pledgesBy.get(r.subjectId!) ?? 0 }))
		.sort((a, b) => b.pledges - a.pledges || b.followers - a.followers);

	const total = ranked.reduce((sum, r) => sum + r.pledges, 0);
	const lines = ranked.map((r) => `- ${fullName(r)}${r.slug ? ` (${leaderPath(r)})` : ''}: ${r.pledges} vote pledge(s), ${r.followers} follower(s)`);

	return {
		label: `vote.ke engagement for the ${ACTIVE_CYCLE} ${title} race — NOT a poll`,
		text: [
			`IMPORTANT: these are counts of activity by self-selected vote.ke users (${total} pledge(s) in total across ${ranked.length} candidate(s)), NOT a poll, NOT a representative sample, and NOT a prediction. You MUST say this plainly in your answer and must not describe anyone as "leading" the actual election.`,
			lines.join('\n')
		].join('\n\n')
	};
}

// ── Leader facts: age comparisons, which need a real birth date ─────────────

/** Age superlatives ("youngest governor"). Only profiles with a sourced
 * dateOfBirth are eligible — users.age is self-declared and goes stale, so
 * ranking on it would produce confidently wrong answers. */
async function leaderFactsSource(q: string): Promise<Source | null> {
	if (!has(q, 'youngest', 'oldest', 'age', 'how old', 'born')) return null;
	const titles = titlesIn(q);

	const rows = await db
		.select({
			firstName: users.firstName,
			otherNames: users.otherNames,
			slug: users.slug,
			dateOfBirth: users.dateOfBirth,
			title: positions.title,
			region: positions.region
		})
		.from(leaders)
		.innerJoin(positions, eq(leaders.positionId, positions.id))
		.innerJoin(users, eq(users.id, leaders.userId))
		.where(
			and(
				isNull(leaders.deletedAt),
				isNotNull(leaders.verifiedAt),
				eq(leaders.status, 'current'),
				isNotNull(users.dateOfBirth),
				isNull(users.deletedAt),
				...(titles.length > 0 ? [or(...titles.map((t) => eq(positions.title, t)))] : [])
			)
		)
		.limit(80);

	if (rows.length === 0) {
		return {
			label: 'Leader ages',
			text: 'No birth dates are on file for the leaders this question covers, so an age comparison cannot be made from vote.ke data. Say that plainly rather than estimating.'
		};
	}

	const ageOf = (dob: string) => {
		const d = new Date(dob);
		const now = new Date();
		let age = now.getFullYear() - d.getFullYear();
		const m = now.getMonth() - d.getMonth();
		if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
		return age;
	};
	const withAges = rows
		.filter((r) => r.dateOfBirth)
		.map((r) => ({ ...r, age: ageOf(r.dateOfBirth as string) }))
		.sort((a, b) => a.age - b.age);

	return {
		label: 'Sitting leaders with a recorded date of birth',
		text: [
			`Ages computed from recorded birth dates (${withAges.length} leader(s) on file — anyone without a date is simply absent, so treat this as "of those on record", not the whole country).`,
			withAges.map((r) => `- ${fullName(r)}, ${r.title}, ${r.region}: ${r.age}${r.slug ? ` (${leaderPath(r)})` : ''}`).join('\n')
		].join('\n')
	};
}

// ── Civics corpus: curated, admin-editable reference text ──────────────────

/** The public FAQ (platform_faqs) — the same answers /faq renders, scored by
 * how much of the question's own wording each entry shares. Unlike the keyword
 * gate the documents use, an FAQ IS a question, so matching question-to-question
 * on overlapping words needs no hand-maintained keyword list. */
async function platformFaqSource(q: string): Promise<Source | null> {
	const words = q
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 3);
	if (words.length === 0) return null;

	const rows = await db
		.select({ section: platformFaqs.section, question: platformFaqs.question, answer: platformFaqs.answer })
		.from(platformFaqs)
		.where(isNull(platformFaqs.deletedAt));

	const scored = rows
		.map((r) => {
			const text = `${r.question} ${r.answer}`.toLowerCase();
			return { ...r, score: words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0) };
		})
		// At least two shared words: a single common word ("what", "vote") matches
		// nearly every entry and would drag the whole FAQ into the prompt.
		.filter((r) => r.score >= 2)
		.sort((a, b) => b.score - a.score)
		.slice(0, 4);
	if (scored.length === 0) return null;

	return {
		label: 'vote.ke FAQ (the same answers published on /faq)',
		text: scored.map((r) => `[${r.section}] Q: ${r.question}\nA: ${r.answer}`).join('\n\n')
	};
}

/** Keyword-matched documents from the platform corpus (platform_documents):
 * registration how-tos, election dates, the citizen/ambassador manuals. */
async function civicsCorpusSource(q: string): Promise<Source | null> {
	const docs = await db
		.select({ title: platformDocuments.title, body: platformDocuments.body, sourceUrl: platformDocuments.sourceUrl, keywords: platformDocuments.keywords })
		.from(platformDocuments)
		.where(isNull(platformDocuments.deletedAt));

	const hits = docs.filter((d) =>
		d.keywords
			.split(',')
			.map((k) => k.trim().toLowerCase())
			.filter(Boolean)
			.some((k) => q.includes(k))
	);
	if (hits.length === 0) return null;

	return {
		label: 'vote.ke civics reference',
		text: hits.map((d) => `--- ${d.title}${d.sourceUrl ? ` (source: ${d.sourceUrl})` : ''} ---\n${d.body}`).join('\n\n')
	};
}

// ── The router ─────────────────────────────────────────────────────────────

export type PlatformGrounding = { sources: Source[]; usedSavedLocation: boolean };

/** Picks and pulls every source the question plausibly needs. Returns an empty
 * list when nothing matches. The caller still answers (the model falls back on
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
	// DATA to answer from. Only the citizen's own prior QUESTIONS are included,
	// past answers are long and would trigger sources by incidental mentions
	// (an answer that links /pricing shouldn't pull the pricing table next turn).
	const q = [...recentQuestions, question].join(' \n ').toLowerCase();
	// Every source is keyword-gated and independent, so they're resolved together
	// rather than in sequence — a question that matches several (e.g. "what have
	// my leaders done" hitting both the digest and the directory) should pay for
	// one round of queries, not one per source.
	const [directory, pricing, digest, race, facts, civics, faq] = await Promise.all([
		directorySource(q, location),
		pricingSource(q),
		activityDigestSource(q, location),
		raceMetricsSource(q),
		leaderFactsSource(q),
		civicsCorpusSource(q),
		platformFaqSource(q)
	]);
	const sources = [
		directory,
		seatDutiesSource(q),
		demographicsSource(q),
		pricing,
		howToSource(q),
		digest,
		race,
		facts,
		civics,
		faq
	].filter((s): s is Source => s !== null);
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
