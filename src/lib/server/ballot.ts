// Candidate resolution for the homepage ballot simulator. Only surfaces
// verified 2027 runs (campaigns). A real ballot lists candidates, which are runs
// for office, not held terms. ACTIVE_CYCLE (2027) is the cycle this ballot covers.
import { randomBytes } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { getOrMintAnonId } from '$lib/server/anonId';
import { db } from '$lib/server/db';
import { ballotSimulations, campaigns, leaders, parties, positions, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, getDomainUser, leaderPath } from '$lib/server/leader';
import type { County, Constituency, Ward } from '$lib/data/geo';

/** A fresh /ballot/[publicId] slug. */
export function newBallotPublicId(): string {
	return randomBytes(6).toString('hex'); // 12 hex chars, matches ballotSimulations.publicId(12)
}

/**
 * Resolves who's acting on the ballot booth or a shared ballot page: a signed-in
 * domain user, or (for a guest) the long-lived 'anon_id' device cookie, minted on
 * first use. Shared by casting, pledging to a candidate, and saving someone
 * else's shared ballot as your own, every write that needs to know "whose is this".
 */
export async function resolveVoterIdentity(
	event: RequestEvent
): Promise<{ domainUser: Awaited<ReturnType<typeof getDomainUser>> | undefined; anonId: string | null; ip: string | null }> {
	const domainUser = event.locals.user ? await getDomainUser(event.locals.user.id) : undefined;
	const anonId: string | null = domainUser ? null : getOrMintAnonId(event.cookies);
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	return { domainUser, anonId, ip };
}

export type BallotLevel = 'president' | 'governor' | 'senator' | 'womanRep' | 'mp' | 'mca';

export type Candidate = {
	candidateId: string; // "campaign:<id>", resolved back to live data on the share page
	name: string;
	initials: string;
	photoUrl: string | null;
	party: string | null;
	path: string;
	verified: boolean;
};

const LEVEL_TITLE: Record<BallotLevel, string> = {
	president: 'President',
	governor: 'Governor',
	senator: 'Senator',
	womanRep: 'Woman Rep',
	mp: 'MP',
	mca: 'MCA'
};

export const BALLOT_LEVELS: BallotLevel[] = ['president', 'governor', 'senator', 'womanRep', 'mp', 'mca'];

const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();

function toCandidate(row: {
	campaigns: typeof campaigns.$inferSelect;
	users: typeof users.$inferSelect;
	partyName: string | null;
}): Candidate {
	const name = fullName(row.users);
	return {
		candidateId: `campaign:${row.campaigns.id}`,
		name,
		initials: initialsOf(name),
		photoUrl: row.users.photoUrl,
		party: row.partyName,
		path: leaderPath(row.users),
		verified: !!row.campaigns.verifiedAt
	};
}

/** A person's current-term party, keyed by user id. The fallback when a 2027 run
 * carries no partyId of its own (most seeded runs don't; an incumbent runs under
 * their current party by default until they declare otherwise). Most recent
 * current term wins if somehow more than one. */
async function currentTermPartyByUser(userIds: number[]): Promise<Map<number, string>> {
	if (!userIds.length) return new Map();
	const rows = await db
		.select({ userId: leaders.userId, partyName: parties.name, startAt: leaders.startAt })
		.from(leaders)
		.innerJoin(parties, eq(leaders.partyId, parties.id))
		.where(and(inArray(leaders.userId, userIds), eq(leaders.status, 'current'), isNull(leaders.deletedAt)));
	const best = new Map<number, { name: string; startAt: Date }>();
	for (const r of rows) {
		const cur = best.get(r.userId);
		if (!cur || r.startAt > cur.startAt) best.set(r.userId, { name: r.partyName, startAt: r.startAt });
	}
	return new Map([...best].map(([id, v]) => [id, v.name]));
}

/** Verified 2027 runs (campaigns) for one position title + exact region name. */
async function verifiedCampaignsFor(title: string, region: string): Promise<Candidate[]> {
	const rows = await db
		.select({ campaigns, users, partyName: parties.name })
		.from(campaigns)
		.innerJoin(positions, eq(campaigns.positionId, positions.id))
		.innerJoin(users, eq(campaigns.subjectUserId, users.id))
		.leftJoin(parties, eq(campaigns.partyId, parties.id))
		.where(
			and(
				eq(positions.title, title),
				eq(positions.region, region),
				eq(campaigns.cycleYear, ACTIVE_CYCLE),
				isNull(campaigns.parentCampaignId),
				isNotNull(campaigns.verifiedAt),
				isNull(campaigns.deletedAt),
				isNull(users.deletedAt)
			)
		);
	// Fill a missing run-party from the candidate's current-term party.
	const fallback = await currentTermPartyByUser(rows.filter((r) => !r.partyName).map((r) => r.users.id));
	return rows.map((r) => toCandidate({ ...r, partyName: r.partyName ?? fallback.get(r.users.id) ?? null }));
}

/**
 * Candidates for one ballot level given the citizen's selected geography.
 * Geography is progressive: only the piece a level actually needs must be set
 * (president none, governor/senator/womanRep the county, mp the constituency,
 * mca the ward), callers guarantee that piece before asking for the level.
 * Returns [] when nothing exists yet (no fabricated candidates). The UI must let the
 * citizen explicitly skip a level rather than block on it.
 */
export async function resolveCandidates(
	level: BallotLevel,
	geo: { county?: County; constituency?: Constituency; ward?: Ward }
): Promise<Candidate[]> {
	const title = LEVEL_TITLE[level];
	let region: string;

	switch (level) {
		case 'president':
			region = 'Kenya';
			break;
		case 'governor':
		case 'senator':
		case 'womanRep':
			region = geo.county!.name;
			break;
		case 'mp':
			region = geo.constituency!.seatName;
			break;
		case 'mca':
			region = geo.ward!.seatName;
			break;
	}

	return verifiedCampaignsFor(title, region);
}

/**
 * Links every guest-cast ballot simulation still carrying this device's anon_id
 * to the account that just signed up or logged in, so casting while signed out
 * (then browsing elsewhere, then creating/logging into an account much later)
 * still connects the ballot to the account. Idempotent and cheap to call on
 * every signup/login: a no-op once already claimed (userId no longer null).
 */
export async function claimGuestBallots(domainUserId: number, anonId: string | null): Promise<void> {
	if (!anonId) return;
	await db
		.update(ballotSimulations)
		.set({ userId: domainUserId })
		.where(and(eq(ballotSimulations.anonId, anonId), isNull(ballotSimulations.userId)));
}

/** Re-resolves a stored candidateId to live display data, or null if gone.
 * "campaign:<id>" is a verified run offered on the ballot; "person:<slug>" is an
 * aspirational write-in picked via quick search. Any profile on the platform,
 * vying for that seat or not. */
export async function resolveCandidateById(candidateId: string | null): Promise<Candidate | null> {
	if (!candidateId) return null;

	if (candidateId.startsWith('campaign:')) {
		const id = Number(candidateId.slice('campaign:'.length));
		const [row] = await db
			.select({ campaigns, users, partyName: parties.name })
			.from(campaigns)
			.innerJoin(users, eq(campaigns.subjectUserId, users.id))
			.leftJoin(parties, eq(campaigns.partyId, parties.id))
			.where(and(eq(campaigns.id, id), isNull(campaigns.deletedAt)));
		if (!row) return null;
		const partyName = row.partyName ?? (await currentTermPartyByUser([row.users.id])).get(row.users.id) ?? null;
		return toCandidate({ ...row, partyName });
	}

	if (candidateId.startsWith('person:')) {
		const slug = candidateId.slice('person:'.length);
		if (!slug) return null;
		const [row] = await db
			.select()
			.from(users)
			.where(and(eq(users.slug, slug), isNull(users.deletedAt)));
		if (!row) return null;
		const name = fullName(row);
		return {
			candidateId,
			name,
			initials: initialsOf(name),
			photoUrl: row.photoUrl,
			// No run for this seat, so no party or IEBC-verified badge to show.
			party: null,
			path: leaderPath(row),
			verified: false
		};
	}

	return null;
}
