// Citizen-side dashboard content: leaders they follow, their pledged votes, and
// their simulated ballots. All keyed off followers.userId / pledges.userId /
// ballotSimulations.userId, which are only populated for signed-in actions
// (anonymous follows/pledges/ballots have none until claimed).
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ballotSimulations, campaigns, followers, leaders, parties, pledges, positions, users } from '$lib/server/db/schema';
import { fullName, leaderPath, slugify } from '$lib/server/leader';
import { BALLOT_LEVELS, resolveCandidateById, type BallotLevel, type Candidate } from '$lib/server/ballot';

/** Every leader this citizen follows (person id + display name), powers /news's
 * per-leader "Following" filter buttons, one per person instead of a single
 * catch-all toggle (digestId IS the person's users.id for digest 'leader', see
 * followers.digestId's comment in schema.ts). */
export async function listFollowedAuthors(userId: number): Promise<{ personId: number; name: string }[]> {
	const rows = await db
		.select({ personId: users.id, firstName: users.firstName, otherNames: users.otherNames })
		.from(followers)
		.innerJoin(users, eq(followers.digestId, users.id))
		.where(and(eq(followers.userId, userId), eq(followers.digest, 'leader'), isNull(followers.deletedAt)));
	return rows.map((r) => ({ personId: r.personId, name: fullName(r) }));
}

export type MyPledge = {
	leaderName: string;
	initials: string;
	photoUrl: string | null;
	verified: boolean;
	party: string | null;
	partyPath: string | null;
	status: string;
	followerCount: number;
	path: string;
	positionTitle: string;
	region: string;
	pledgedAt: string;
};

export async function listMyPledges(userId: number): Promise<MyPledge[]> {
	// Joined off the campaign itself (subjectUserId + positionId), never REQUIRING
	// campaigns.leaderId: that's only set for incumbents, so routing through
	// leaders would silently drop every pledge to a pure aspirant's run. The left
	// join still picks up an incumbent's status ('current' etc.) when it exists.
	const rows = await db
		.select()
		.from(pledges)
		.innerJoin(campaigns, eq(pledges.campaignId, campaigns.id))
		.innerJoin(users, eq(campaigns.subjectUserId, users.id))
		.innerJoin(positions, eq(campaigns.positionId, positions.id))
		.leftJoin(parties, eq(campaigns.partyId, parties.id))
		.leftJoin(leaders, eq(campaigns.leaderId, leaders.id))
		.where(and(eq(pledges.userId, userId), isNull(pledges.deletedAt)))
		.orderBy(desc(pledges.createdAt));

	// Follower reach per pledged person, same figure the directory cards show.
	const personIds = [...new Set(rows.map((r) => r.users.id))];
	const followerRows = personIds.length
		? await db
				.select({ userId: followers.digestId, n: count() })
				.from(followers)
				.where(and(eq(followers.digest, 'leader'), inArray(followers.digestId, personIds), isNull(followers.deletedAt)))
				.groupBy(followers.digestId)
		: [];
	const followersBy = new Map(followerRows.map((r) => [r.userId, r.n]));

	return rows.map((r) => {
		const name = fullName(r.users);
		return {
			leaderName: name,
			initials: name
				.split(/\s+/)
				.map((w) => w[0])
				.join('')
				.slice(0, 2)
				.toUpperCase(),
			photoUrl: r.users.photoUrl,
			verified: !!r.campaigns.verifiedAt,
			party: r.parties?.name ?? null,
			partyPath: r.parties?.name ? `/parties/${slugify(r.parties.name)}` : null,
			status: r.leaders?.status ?? 'aspirant',
			followerCount: followersBy.get(r.users.id) ?? 0,
			path: leaderPath(r.users),
			positionTitle: r.positions.title,
			region: r.positions.region,
			pledgedAt: r.pledges.createdAt.toISOString()
		};
	});
}

export type MyBallot = {
	publicId: string;
	county: string;
	constituency: string;
	ward: string;
	createdAt: string;
	results: { level: BallotLevel; candidate: Candidate | null }[];
};

/** Every simulated ballot linked to this account: cast signed in, or claimed
 * later via signup/login (claimGuestBallots) or Save Vote on someone else's
 * shared link, newest first. Each carries its own resolved candidate per level
 * (never frozen: re-fetched live, same as the /ballot/[publicId] share page),
 * so the My Vote table can render an actual leader card per cell. */
export async function listMyBallots(userId: number): Promise<MyBallot[]> {
	const rows = await db
		.select()
		.from(ballotSimulations)
		.where(eq(ballotSimulations.userId, userId))
		.orderBy(desc(ballotSimulations.createdAt));

	return Promise.all(
		rows.map(async (r) => {
			const selections = r.selections as Record<BallotLevel, string | null>;
			const results = await Promise.all(
				BALLOT_LEVELS.map(async (level) => ({ level, candidate: await resolveCandidateById(selections[level] ?? null) }))
			);
			return {
				publicId: r.publicId,
				county: r.county,
				constituency: r.constituency,
				ward: r.ward,
				createdAt: r.createdAt.toISOString(),
				results
			};
		})
	);
}
