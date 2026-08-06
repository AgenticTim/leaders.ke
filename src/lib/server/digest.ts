// The morning brief: what happened to a leader's coverage and inbox overnight,
// delivered to their team right after the daily crawl finishes.
//
// This is the comms aide's whole job in one message. Their alternative today is
// scrolling a WhatsApp group of clippings, so the brief has to arrive without
// anyone visiting the site, which is why it goes out through notifyUser (a
// dashboard notification AND an email) rather than living on a page.
//
// Gating matches the News tab exactly (see [slug]/posts): a team without the PR
// AI Agent perk gets the COUNTS and nothing else, never the headlines, so the
// brief demonstrates what the paid desk knows without giving it away.
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { conversations, managers, messages, posts, tags, users } from '$lib/server/db/schema';
import { user as authUsers } from '$lib/server/db/auth.schema';
import { fullName } from '$lib/server/leader';
import { getPersonTier } from '$lib/server/invites';
import { getPackageFeatures } from '$lib/server/packages';
import { notifyUser } from '$lib/server/notifications';
import { decodeHtmlEntities } from '$lib/utils/entities';
import { newsSourceName, readableOutlet } from '$lib/utils/newsSource';

/** Coverage in the last day that trips the "something is happening" flag. Same
 * numbers the dashboard's crisis banner uses, so the brief and the banner can
 * never disagree about whether today was a bad day. */
const CRISIS_MENTIONS_24H = 3;
const CRISIS_NEGATIVES_24H = 2;
/** Headlines carried in the brief. Enough to see the shape of the day without
 * turning an email into the feed. */
const BRIEF_HEADLINES = 3;

type PersonDigest = {
	subjectUserId: number;
	name: string;
	slug: string | null;
	mentions: number;
	positive: number;
	negative: number;
	unanswered: number;
	headlines: { title: string; outlet: string | null }[];
};

/** Every person whose coverage or inbox moved in the last 24 hours. Quiet
 * profiles are skipped entirely: a daily email that says "nothing happened" is
 * how a daily email gets filtered to spam. */
async function collect(since: Date): Promise<PersonDigest[]> {
	const [mentionRows, inboxRows] = await Promise.all([
		db
			.select({
				subjectUserId: tags.subjectUserId,
				mentions: sql<number>`count(*)`.mapWith(Number),
				positive: sql<number>`count(*) filter (where ${posts.sentiment} = 'positive')`.mapWith(Number),
				negative: sql<number>`count(*) filter (where ${posts.sentiment} = 'negative')`.mapWith(Number)
			})
			.from(tags)
			.innerJoin(posts, eq(tags.postId, posts.id))
			.where(and(isNull(tags.deletedAt), isNull(posts.deletedAt), isNull(posts.creatorId), gte(tags.createdAt, since)))
			.groupBy(tags.subjectUserId),
		// Citizen questions still waiting on a human: a follower message routed to
		// the team with no later reply from anyone on that team.
		db
			.select({
				subjectUserId: conversations.scopeId,
				unanswered: sql<number>`count(*)`.mapWith(Number)
			})
			.from(messages)
			.innerJoin(conversations, eq(messages.conversationId, conversations.id))
			.where(
				and(
					eq(conversations.scope, 'leader'),
					eq(messages.sender, 'follower'),
					eq(messages.target, 'manager'),
					sql`not exists (
						select 1 from ${messages} reply
						where reply.conversation_id = ${messages.conversationId}
						  and reply.created_at > ${messages.createdAt}
						  and reply.sender in ('leader', 'manager', 'ambassador')
					)`
				)
			)
			.groupBy(conversations.scopeId)
	]);

	const byPerson = new Map<number, PersonDigest>();
	const blank = (id: number): PersonDigest => ({
		subjectUserId: id,
		name: '',
		slug: null,
		mentions: 0,
		positive: 0,
		negative: 0,
		unanswered: 0,
		headlines: []
	});
	for (const r of mentionRows) {
		const d = byPerson.get(r.subjectUserId) ?? blank(r.subjectUserId);
		d.mentions = r.mentions;
		d.positive = r.positive;
		d.negative = r.negative;
		byPerson.set(r.subjectUserId, d);
	}
	for (const r of inboxRows) {
		if (r.subjectUserId === null) continue;
		const d = byPerson.get(r.subjectUserId) ?? blank(r.subjectUserId);
		d.unanswered = r.unanswered;
		byPerson.set(r.subjectUserId, d);
	}
	if (byPerson.size === 0) return [];

	const ids = [...byPerson.keys()];
	const people = await db
		.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames, slug: users.slug })
		.from(users)
		.where(and(inArray(users.id, ids), isNull(users.deletedAt)));
	for (const p of people) {
		const d = byPerson.get(p.id);
		if (d) {
			d.name = fullName(p);
			d.slug = p.slug;
		}
	}
	// A person whose row vanished (deleted mid-run) has no name; drop them.
	return [...byPerson.values()].filter((d) => d.name);
}

/** The newest headlines for one person in the window, for the unlocked brief. */
async function headlinesFor(subjectUserId: number, since: Date) {
	const rows = await db
		.select({ title: posts.title, sourceUrl: posts.sourceUrl })
		.from(tags)
		.innerJoin(posts, eq(tags.postId, posts.id))
		.where(
			and(
				eq(tags.subjectUserId, subjectUserId),
				isNull(tags.deletedAt),
				isNull(posts.deletedAt),
				isNull(posts.creatorId),
				gte(tags.createdAt, since)
			)
		)
		.orderBy(desc(posts.createdAt))
		.limit(BRIEF_HEADLINES);
	return rows.map((r) => ({
		title: decodeHtmlEntities(r.title),
		outlet: readableOutlet(newsSourceName(r.sourceUrl, decodeHtmlEntities(r.title)))
	}));
}

function subjectLine(d: PersonDigest, crisis: boolean): string {
	if (crisis) return `${d.name}: ${d.negative} negative ${d.negative === 1 ? 'story' : 'stories'} overnight`;
	if (d.mentions > 0) return `${d.name}: ${d.mentions} new ${d.mentions === 1 ? 'mention' : 'mentions'}`;
	return `${d.name}: ${d.unanswered} question${d.unanswered === 1 ? '' : 's'} waiting`;
}

/**
 * Builds and sends the daily brief. Returns what it did, so the caller can log
 * one line rather than the module printing its own.
 *
 * Sent to every ACTIVE manager of a person, plus the person themself when they
 * have their own account: whoever opens it first is who acts on it.
 */
export async function sendDailyDigests(): Promise<{ people: number; recipients: number }> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const digests = await collect(since);
	if (digests.length === 0) return { people: 0, recipients: 0 };

	let recipients = 0;
	for (const d of digests) {
		const features = await getPackageFeatures(await getPersonTier(d.subjectUserId));
		const unlocked = !!features?.prAiAgent;
		const crisis = d.mentions >= CRISIS_MENTIONS_24H || d.negative >= CRISIS_NEGATIVES_24H;

		const lines: string[] = [];
		if (d.mentions > 0) {
			lines.push(
				`${d.mentions} new mention${d.mentions === 1 ? '' : 's'} in the last 24 hours` +
					(d.positive || d.negative ? ` (${d.positive} positive, ${d.negative} negative).` : '.')
			);
			if (unlocked) {
				// Locked teams get the counts above but never the coverage itself, the
				// same line the News tab draws.
				for (const h of await headlinesFor(d.subjectUserId, since)) {
					lines.push(`- ${h.outlet ? `${h.outlet}: ` : ''}${h.title}`);
				}
			} else {
				lines.push('Upgrade to read the coverage, see its tone, and draft a response.');
			}
		}
		if (d.unanswered > 0) {
			lines.push(
				`${d.unanswered} citizen question${d.unanswered === 1 ? '' : 's'} still waiting for a reply.`
			);
		}
		if (crisis && unlocked) {
			lines.push('That is above your usual day. Worth a look before it sets the tone.');
		}

		const href = d.slug ? `/dashboard/${d.slug}/posts?filter=mentions` : '/dashboard';
		const managerRows = await db
			.select({ userId: managers.userId })
			.from(managers)
			.where(and(eq(managers.subjectUserId, d.subjectUserId), eq(managers.isActive, true), isNull(managers.deletedAt)));
		const targets = new Set<number>(managerRows.map((m) => m.userId));
		targets.add(d.subjectUserId); // the leader's own account, when they have one

		// Only accounts with a VERIFIED email. Seeded profiles carry a real-looking
		// address on a domain that doesn't exist (@seed.leaders.ke, 1,100+ of them
		// in production), so anything looser turns this into a daily burst of hard
		// bounces and burns the sending domain's reputation. Verification is the
		// only signal that a human ever received mail at that address.
		const reachable = await db
			.select({ id: users.id })
			.from(users)
			.innerJoin(authUsers, eq(users.authUserId, authUsers.id))
			.where(and(inArray(users.id, [...targets]), isNull(users.deletedAt), eq(authUsers.emailVerified, true)));

		for (const { id: userId } of reachable) {
			await notifyUser(userId, {
				kind: 'moderation',
				title: subjectLine(d, crisis),
				body: lines.join('\n'),
				href,
				linkLabel: unlocked ? 'Open your news desk' : 'See your package'
			});
			recipients++;
		}
	}
	return { people: digests.length, recipients };
}
