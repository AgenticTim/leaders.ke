// Ambassador-side view of team assignments: which campaign(s) they mobilize for,
// self-service leave (a manager can also remove them from /dashboard/team), and
// citizen recruitment (blueprint funnel A: ambassador adds citizen via dashboard).
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ambassadors, campaigns, followers, leaders, pledges, positions, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, leaderPath } from '$lib/server/leader';
import { runStatus } from '$lib/utils/seat';

export type AmbassadorAssignment = {
	id: number;
	/** The PERSON mobilized for (users.id). The mobilize route's URL segment. */
	subjectId: number;
	leaderName: string;
	positionTitle: string;
	region: string;
	leaderPath: string;
};

/** This user's active ambassador assignments, across every campaign they mobilize
 * for. Assignments hang off the PERSON, so their seat comes from that person's
 * lead position: a held term (preferring non-'former') else their current-cycle
 * run. A pure aspirant has no leaders row, only a run. */
export async function listAmbassadorAssignments(userId: number): Promise<AmbassadorAssignment[]> {
	const rows = await db
		.select({ id: ambassadors.id, subject: users })
		.from(ambassadors)
		.innerJoin(users, eq(ambassadors.subjectUserId, users.id))
		.where(and(eq(ambassadors.userId, userId), eq(ambassadors.isActive, true), isNull(ambassadors.deletedAt)));
	if (rows.length === 0) return [];

	const subjectIds = rows.map((r) => r.subject.id);
	const [termRows, runRows] = await Promise.all([
		db
			.select({ userId: leaders.userId, status: leaders.status, title: positions.title, region: positions.region })
			.from(leaders)
			.innerJoin(positions, eq(leaders.positionId, positions.id))
			.where(and(inArray(leaders.userId, subjectIds), isNull(leaders.deletedAt))),
		db
			.select({ userId: campaigns.subjectUserId, title: positions.title, region: positions.region, verifiedAt: campaigns.verifiedAt })
			.from(campaigns)
			.innerJoin(positions, eq(campaigns.positionId, positions.id))
			.where(and(inArray(campaigns.subjectUserId, subjectIds), eq(campaigns.cycleYear, ACTIVE_CYCLE), isNull(campaigns.parentCampaignId), isNull(campaigns.deletedAt)))
	]);
	// Held non-former term beats a run beats a former term. The same "lead seat"
	// priority used elsewhere (e.g. the admin claims table).
	const seatBySubject = new Map<number, { title: string; region: string; status: string }>();
	for (const t of termRows) {
		const held = seatBySubject.get(t.userId);
		if (!held || (held.status === 'former' && t.status !== 'former')) {
			seatBySubject.set(t.userId, { title: t.title, region: t.region, status: t.status });
		}
	}
	for (const r of runRows) {
		const held = seatBySubject.get(r.userId);
		if (!held || held.status === 'former') seatBySubject.set(r.userId, { title: r.title, region: r.region, status: runStatus(r.verifiedAt) });
	}

	return rows.map((r) => {
		const seat = seatBySubject.get(r.subject.id);
		return {
			id: r.id,
			subjectId: r.subject.id,
			leaderName: fullName(r.subject),
			positionTitle: seat?.title ?? '',
			region: seat?.region ?? '',
			leaderPath: leaderPath(r.subject)
		};
	});
}

/** Self-service leave: scoped to the caller's own row so they can't remove someone else's. */
export async function leaveAmbassadorRole(ambassadorId: number, userId: number) {
	await db
		.update(ambassadors)
		.set({ isActive: false, deletedAt: new Date() })
		.where(and(eq(ambassadors.id, ambassadorId), eq(ambassadors.userId, userId)));
}

/** Whether this user actively mobilizes for this person's campaign. The write
 * guard for every ambassador action, scoped to the person (subjectUserId). */
export async function isActiveAmbassador(userId: number, subjectUserId: number): Promise<boolean> {
	const [row] = await db
		.select({ id: ambassadors.id })
		.from(ambassadors)
		.where(
			and(
				eq(ambassadors.userId, userId),
				eq(ambassadors.subjectUserId, subjectUserId),
				eq(ambassadors.isActive, true),
				isNull(ambassadors.deletedAt)
			)
		);
	return !!row;
}

/**
 * Adds a citizen to a campaign's follower roster on an ambassador's behalf,
 * same shape and contact dedupe as the public follow form, plus `addedBy` so the
 * recruit stays attributed to whoever signed them up (the follower row itself
 * stays attached to the campaign if the ambassador is later removed).
 */
export async function addCitizenFollower(
	recruiterUserId: number,
	subjectUserId: number,
	input: { name: string; phone: string; email: string; county: string | null; ward: string | null }
) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const phone = input.phone.replace(/[^\d+]/g, '');
	if (!name || (!phone && !email)) {
		return { ok: false as const, error: 'A name and a phone or email are required.' };
	}
	if (phone && phone.length < 9) return { ok: false as const, error: 'Enter a valid phone number.' };
	if (email && !email.includes('@')) return { ok: false as const, error: 'Enter a valid email address.' };
	const emailAddress = email || null;
	const phoneNumber = phone || null;

	if (!subjectUserId) return { ok: false as const, error: 'Campaign not found.' };

	// App-layer dedupe for account-less follows: one live follow per contact per leader.
	const [duplicate] = await db
		.select({ id: followers.id })
		.from(followers)
		.where(
			and(
				eq(followers.digest, 'leader'),
				eq(followers.digestId, subjectUserId),
				isNull(followers.deletedAt),
				or(
					emailAddress ? eq(followers.emailAddress, emailAddress) : undefined,
					phoneNumber ? eq(followers.phoneNumber, phoneNumber) : undefined
				)
			)
		)
		.limit(1);
	if (duplicate) return { ok: false as const, error: 'That contact already follows this campaign.' };

	await db.insert(followers).values({
		name,
		emailAddress,
		phoneNumber,
		county: input.county,
		ward: input.ward || null,
		digest: 'leader',
		digestId: subjectUserId,
		// Each provided contact channel doubles as a digest opt-in.
		email: !!emailAddress,
		sms: !!phoneNumber,
		addedBy: recruiterUserId
	});
	return { ok: true as const, name };
}

export type Recruit = {
	id: number;
	name: string;
	phone: string | null;
	email: string | null;
	ward: string | null;
	joinedAt: string;
};

/** One page of the citizens this user recruited for this campaign, newest first.
 * The ambassador view is scoped to their own recruits, never the full roster. */
export async function listRecruits(
	recruiterUserId: number,
	subjectUserId: number,
	page: number,
	pageSize: number
): Promise<{ recruits: Recruit[]; total: number }> {
	const filter = and(
		eq(followers.digest, 'leader'),
		eq(followers.digestId, subjectUserId),
		eq(followers.addedBy, recruiterUserId),
		isNull(followers.deletedAt)
	);
	const [rows, [{ n: total }]] = await Promise.all([
		db
			.select()
			.from(followers)
			.where(filter)
			.orderBy(desc(followers.createdAt))
			.limit(pageSize)
			.offset((page - 1) * pageSize),
		db.select({ n: count() }).from(followers).where(filter)
	]);

	return {
		recruits: rows.map((f) => ({
			id: f.id,
			name: f.name ?? 'Follower',
			phone: f.phoneNumber,
			email: f.emailAddress,
			ward: f.ward,
			joinedAt: f.createdAt.toISOString()
		})),
		total
	};
}

/**
 * Records a vote pledge an ambassador gathered in the field (blueprint funnel A).
 * A citizen who pledges but may not want to follow for news, so this is kept
 * separate from addCitizenFollower. The pledge attaches to the campaign directly
 * (never a leaders row) with contact capture and `addedBy` attribution; contact is
 * optional (a pledge can be just a name), deduped per campaign only when a contact
 * is given (a name alone can't be told apart from a namesake).
 */
export async function addCitizenPledge(
	recruiterUserId: number,
	campaignId: number,
	input: { name: string; phone: string; email: string; county: string | null; ward: string | null }
) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const phone = input.phone.replace(/[^\d+]/g, '');
	if (!name) return { ok: false as const, error: 'Enter the citizen’s name.' };
	if (phone && phone.length < 9) return { ok: false as const, error: 'Enter a valid phone number.' };
	if (email && !email.includes('@')) return { ok: false as const, error: 'Enter a valid email address.' };
	const emailAddress = email || null;
	const phoneNumber = phone || null;

	if (emailAddress || phoneNumber) {
		const [duplicate] = await db
			.select({ id: pledges.id })
			.from(pledges)
			.where(
				and(
					eq(pledges.campaignId, campaignId),
					isNull(pledges.deletedAt),
					or(
						emailAddress ? eq(pledges.email, emailAddress) : undefined,
						phoneNumber ? eq(pledges.sms, phoneNumber) : undefined
					)
				)
			)
			.limit(1);
		if (duplicate) return { ok: false as const, error: 'That contact has already pledged to this campaign.' };
	}

	await db.insert(pledges).values({
		campaignId,
		name,
		email: emailAddress,
		sms: phoneNumber,
		constituency: input.county, // pledges predate a county column; constituency holds the geo label
		ward: input.ward || null,
		addedBy: recruiterUserId
	});
	return { ok: true as const, name };
}

export type RecruitedPledge = {
	id: number;
	name: string;
	phone: string | null;
	email: string | null;
	ward: string | null;
	pledgedAt: string;
};

/** Pledges this ambassador recruited for this campaign, newest first. A recruited
 * pledge may carry a linked account (name from users) or be contact-only (name
 * from the pledge row). */
export async function listRecruitedPledges(
	recruiterUserId: number,
	campaignId: number,
	page: number,
	pageSize: number
): Promise<{ pledges: RecruitedPledge[]; total: number }> {
	const filter = and(eq(pledges.campaignId, campaignId), eq(pledges.addedBy, recruiterUserId), isNull(pledges.deletedAt));
	const [rows, [{ n: total }]] = await Promise.all([
		db
			.select({ p: pledges, u: users })
			.from(pledges)
			.leftJoin(users, eq(pledges.userId, users.id))
			.where(filter)
			.orderBy(desc(pledges.createdAt))
			.limit(pageSize)
			.offset((page - 1) * pageSize),
		db.select({ n: count() }).from(pledges).where(filter)
	]);
	return {
		pledges: rows.map(({ p, u }) => ({
			id: p.id,
			name: u ? fullName(u) : (p.name ?? 'Citizen'),
			phone: p.sms,
			email: p.email,
			ward: p.ward,
			pledgedAt: p.createdAt.toISOString()
		})),
		total
	};
}
