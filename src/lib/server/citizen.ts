// Citizen-side dashboard content: leaders they follow, their pledged votes, and
// their simulated ballots. All keyed off followers.userId / pledges.userId /
// ballotSimulations.userId, which are only populated for signed-in actions
// (anonymous follows/pledges/ballots have none until claimed).
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ballotSimulations, campaigns, followers, leaders, pledges, positions, users } from '$lib/server/db/schema';
import { fullName, leaderPath } from '$lib/server/leader';
import { BALLOT_LEVELS, resolveCandidateById, type BallotLevel, type Candidate } from '$lib/server/ballot';

/** Every leader this citizen follows (person id + display name) — powers /news's
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
	path: string;
	positionTitle: string;
	region: string;
	pledgedAt: string;
};

export async function listMyPledges(userId: number): Promise<MyPledge[]> {
	const rows = await db
		.select()
		.from(pledges)
		.innerJoin(campaigns, eq(pledges.campaignId, campaigns.id))
		.innerJoin(leaders, eq(campaigns.leaderId, leaders.id))
		.innerJoin(users, eq(leaders.userId, users.id))
		.innerJoin(positions, eq(leaders.positionId, positions.id))
		.where(and(eq(pledges.userId, userId), isNull(pledges.deletedAt)));

	return rows.map((r) => ({
		leaderName: fullName(r.users),
		path: leaderPath(r.users),
		positionTitle: r.positions.title,
		region: r.positions.region,
		pledgedAt: r.pledges.createdAt.toISOString()
	}));
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
 * (never frozen — re-fetched live, same as the /ballot/[publicId] share page),
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
