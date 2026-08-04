import { and, count, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ACTIVE_CYCLE, fullName, leaderPath } from '$lib/server/leader';
import { campaigns, followers, leaders, pillars, posts, tags, users } from '$lib/server/db/schema';
import { requireLeader } from '$lib/server/dashboard';
import { getPersonTier } from '$lib/server/invites';
import { getPackageFeatures } from '$lib/server/packages';
import type { PageServerLoad } from './$types';

export type SentimentBreakdown = { positive: number; neutral: number; negative: number };

// Competitor watch: everyone else vying for (or holding) the same seat, with
// the public signals that matter: followers, output, coverage.
export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	const seatId = ctx.position?.id ?? 0;

	// Sentiment Intelligence Suite (Dominate perk): the marketing claim covers
	// rivals, not just the viewer's own coverage, so it's gated the same way
	// here as the News tab gates the PR AI Agent. An admin-toggled feature,
	// not a hardcoded tier check.
	const tier = await getPersonTier(ctx.profileUser.id);
	const sentimentUnlocked = !!(await getPackageFeatures(tier))?.sentimentSuite;

	// Rivals at this seat: other held terms, plus other verified 2027 runs (aspirants).
	const [heldRivals, runRivals] = await Promise.all([
		db
			.select({ userId: users.id, users, status: leaders.status, verified: leaders.verifiedAt })
			.from(leaders)
			.innerJoin(users, eq(leaders.userId, users.id))
			.where(
				and(
					eq(leaders.positionId, seatId),
					ne(leaders.userId, ctx.profileUser.id),
					isNull(leaders.deletedAt),
					isNull(users.deletedAt)
				)
			),
		db
			.select({ userId: users.id, users, verified: campaigns.verifiedAt })
			.from(campaigns)
			.innerJoin(users, eq(campaigns.subjectUserId, users.id))
			.where(
				and(
					eq(campaigns.positionId, seatId),
					eq(campaigns.cycleYear, ACTIVE_CYCLE),
					isNull(campaigns.parentCampaignId),
					isNotNull(campaigns.verifiedAt),
					isNull(campaigns.deletedAt),
					isNull(users.deletedAt),
					ne(campaigns.subjectUserId, ctx.profileUser.id)
				)
			)
	]);
	// One rival per person; a held term wins the status label over a run.
	const rivalByPerson = new Map<
		number,
		{ users: typeof users.$inferSelect; status: string; verified: boolean }
	>();
	for (const r of runRivals)
		rivalByPerson.set(r.userId, { users: r.users, status: 'aspirant', verified: !!r.verified });
	for (const r of heldRivals)
		rivalByPerson.set(r.userId, { users: r.users, status: r.status, verified: !!r.verified });

	// Positive/neutral/negative counts across a person's lifetime coverage
	// (posts.sentiment, classification is paused in $lib/server/newsIngest.ts
	// pending a redesign, so this reads whatever's already classified from
	// before the pause; nothing new backfills it right now).
	// Only run when the perk is unlocked: a locked Competitors tab has nothing
	// to show here, so there's no reason to pay for the extra query per rival.
	const sentimentFor = async (personId: number): Promise<SentimentBreakdown> => {
		const rows = await db
			.select({ sentiment: posts.sentiment, n: count() })
			.from(tags)
			.innerJoin(posts, eq(tags.postId, posts.id))
			.where(
				and(
					eq(tags.subjectUserId, personId),
					isNull(tags.deletedAt),
					isNull(posts.deletedAt),
					isNotNull(posts.sentiment)
				)
			)
			.groupBy(posts.sentiment);
		const breakdown: SentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
		for (const r of rows) {
			if (r.sentiment === 'positive' || r.sentiment === 'neutral' || r.sentiment === 'negative')
				breakdown[r.sentiment] = r.n;
		}
		return breakdown;
	};

	const statsFor = async (personId: number) => {
		const [[followerRow], [postRow], [pillarRow], [mentionRow], latest, sentiment] =
			await Promise.all([
				db
					.select({ n: count() })
					.from(followers)
					.where(
						and(
							eq(followers.digest, 'leader'),
							eq(followers.digestId, personId),
							isNull(followers.deletedAt)
						)
					),
				db
					.select({ n: count() })
					.from(posts)
					.where(
						and(
							eq(posts.subjectUserId, personId),
							eq(posts.medium, 'web'),
							eq(posts.public, true),
							isNull(posts.deletedAt)
						)
					),
				db
					.select({ n: count() })
					.from(pillars)
					.innerJoin(campaigns, eq(pillars.campaignId, campaigns.id))
					.where(and(eq(campaigns.subjectUserId, personId), isNull(pillars.deletedAt))),
				db
					.select({ n: count() })
					.from(tags)
					.where(and(eq(tags.subjectUserId, personId), isNull(tags.deletedAt))),
				db
					.select({ title: posts.title, createdAt: posts.createdAt })
					.from(posts)
					.where(
						and(
							eq(posts.subjectUserId, personId),
							eq(posts.medium, 'web'),
							eq(posts.public, true),
							isNull(posts.deletedAt)
						)
					)
					.orderBy(desc(posts.createdAt))
					.limit(1),
				sentimentUnlocked ? sentimentFor(personId) : Promise.resolve(null)
			]);
		return {
			followers: followerRow.n,
			postCount: postRow.n,
			pillarCount: pillarRow.n,
			mentionCount: mentionRow.n,
			sentiment,
			latestPost: latest[0]
				? { title: latest[0].title, createdAt: latest[0].createdAt.toISOString() }
				: null
		};
	};

	const dbRivals = await Promise.all(
		[...rivalByPerson.values()].map(async (r) => ({
			name: fullName(r.users),
			path: leaderPath(r.users),
			party: null as string | null,
			status: r.status,
			verified: r.verified,
			...(await statsFor(r.users.id))
		}))
	);

	const mine = await statsFor(ctx.profileUser.id);

	return {
		seat: ctx.position ? `${ctx.position.title}, ${ctx.position.region}` : '',
		sentimentUnlocked,
		mine,
		rivals: dbRivals.sort((a, b) => b.followers - a.followers)
	};
};
