// Deliveries: what a leader lists as delivered under a SPECIFIC held term
// (leaders.id) or a non-elective experience (experience.id) — retrospective
// receipts, distinct from a run's forward-looking manifesto pillars. Merged into
// the Profile tab (each experience item carries its own deliveries inline), so
// this module holds the shared list/add/remove/pin logic that page's actions call.
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { deliveries, experience, leaders } from '$lib/server/db/schema';

// Only PINNED deliveries show on the public profile — the leader curates their
// best few. Capped here (not a DB constraint), counted across every term/experience.
export const MAX_PINNED_DELIVERIES = 5;

export type DeliveryItem = { id: number; title: string; description: string | null; pinned: boolean };

/** Encodes which table a delivery attaches to in one value: "leader:123" or
 * "experience:45" — the same target string the Profile tab renders per item. */
export function parseDeliveryTarget(raw: string): { kind: 'leader' | 'experience'; id: number } | null {
	const [kind, idRaw] = raw.split(':');
	const id = Number(idRaw) || 0;
	if ((kind !== 'leader' && kind !== 'experience') || !id) return null;
	return { kind, id };
}

/** This person's own leaders/experience ids — every write scopes to one of these
 * before touching a delivery, so nobody can act on someone else's row by id. */
export async function ownDeliveryIds(subjectUserId: number): Promise<{ leaderIds: number[]; experienceIds: number[] }> {
	const [ownLeaders, ownExperience] = await Promise.all([
		db.select({ id: leaders.id }).from(leaders).where(and(eq(leaders.userId, subjectUserId), isNull(leaders.deletedAt))),
		db.select({ id: experience.id }).from(experience).where(and(eq(experience.subjectUserId, subjectUserId), isNull(experience.deletedAt)))
	]);
	return { leaderIds: ownLeaders.map((l) => l.id), experienceIds: ownExperience.map((e) => e.id) };
}

/** Deliveries for the given term/experience ids, keyed by target string
 * ("leader:<id>" / "experience:<id>"), oldest first. */
export async function listDeliveriesByTarget(leaderIds: number[], experienceIds: number[]): Promise<Record<string, DeliveryItem[]>> {
	const [byLeader, byExperience] = await Promise.all([
		leaderIds.length
			? db
					.select({ id: deliveries.id, leaderId: deliveries.leaderId, title: deliveries.title, description: deliveries.description, pinnedAt: deliveries.pinnedAt })
					.from(deliveries)
					.where(and(inArray(deliveries.leaderId, leaderIds), isNull(deliveries.deletedAt)))
					.orderBy(asc(deliveries.createdAt))
			: [],
		experienceIds.length
			? db
					.select({ id: deliveries.id, experienceId: deliveries.experienceId, title: deliveries.title, description: deliveries.description, pinnedAt: deliveries.pinnedAt })
					.from(deliveries)
					.where(and(inArray(deliveries.experienceId, experienceIds), isNull(deliveries.deletedAt)))
					.orderBy(asc(deliveries.createdAt))
			: []
	]);

	const grouped: Record<string, DeliveryItem[]> = {};
	for (const d of byLeader) {
		(grouped[`leader:${d.leaderId}`] ??= []).push({ id: d.id, title: d.title, description: d.description, pinned: !!d.pinnedAt });
	}
	for (const d of byExperience) {
		(grouped[`experience:${d.experienceId}`] ??= []).push({ id: d.id, title: d.title, description: d.description, pinned: !!d.pinnedAt });
	}
	return grouped;
}

/** Total live pinned deliveries across this person's terms/experience. */
export async function pinnedDeliveryCount(subjectUserId: number): Promise<number> {
	const { leaderIds, experienceIds } = await ownDeliveryIds(subjectUserId);
	const grouped = await listDeliveriesByTarget(leaderIds, experienceIds);
	return Object.values(grouped).flat().filter((d) => d.pinned).length;
}

export async function addDelivery(subjectUserId: number, targetRaw: string, title: string, description: string) {
	const parsed = parseDeliveryTarget(targetRaw);
	title = title.trim();
	description = description.trim();
	if (!parsed) return { ok: false as const, error: 'Choose which term or experience this delivery belongs to.' };
	if (!title) return { ok: false as const, error: 'Every delivery needs a title.' };
	if (description.length > 1000) return { ok: false as const, error: 'Delivery descriptions are limited to 1000 characters.' };

	// The target must actually belong to this person — never trust the id off the client.
	if (parsed.kind === 'leader') {
		const [term] = await db.select({ id: leaders.id }).from(leaders).where(and(eq(leaders.id, parsed.id), eq(leaders.userId, subjectUserId), isNull(leaders.deletedAt)));
		if (!term) return { ok: false as const, error: 'That term is not yours.' };
		await db.insert(deliveries).values({ leaderId: term.id, title, description: description || null });
	} else {
		const [exp] = await db.select({ id: experience.id }).from(experience).where(and(eq(experience.id, parsed.id), eq(experience.subjectUserId, subjectUserId), isNull(experience.deletedAt)));
		if (!exp) return { ok: false as const, error: 'That experience entry is not yours.' };
		await db.insert(deliveries).values({ experienceId: exp.id, title, description: description || null });
	}
	return { ok: true as const };
}

export async function removeDelivery(subjectUserId: number, id: number) {
	const { leaderIds, experienceIds } = await ownDeliveryIds(subjectUserId);
	const [target] = await db.select({ id: deliveries.id, leaderId: deliveries.leaderId, experienceId: deliveries.experienceId }).from(deliveries).where(eq(deliveries.id, id));
	const owned = target && ((target.leaderId && leaderIds.includes(target.leaderId)) || (target.experienceId && experienceIds.includes(target.experienceId)));
	if (!owned) return { ok: false as const, error: 'That delivery is not yours to remove.' };
	await db.update(deliveries).set({ deletedAt: new Date() }).where(eq(deliveries.id, id));
	return { ok: true as const };
}

export async function togglePinDelivery(subjectUserId: number, id: number) {
	const { leaderIds, experienceIds } = await ownDeliveryIds(subjectUserId);
	const [target] = await db.select({ id: deliveries.id, leaderId: deliveries.leaderId, experienceId: deliveries.experienceId, pinnedAt: deliveries.pinnedAt }).from(deliveries).where(and(eq(deliveries.id, id), isNull(deliveries.deletedAt)));
	const owned = target && ((target.leaderId && leaderIds.includes(target.leaderId)) || (target.experienceId && experienceIds.includes(target.experienceId)));
	if (!owned) return { ok: false as const, error: 'That delivery is not yours to pin.' };

	if (target.pinnedAt) {
		await db.update(deliveries).set({ pinnedAt: null }).where(eq(deliveries.id, id));
		return { ok: true as const };
	}

	// Cap across this person's every term/experience delivery.
	const [pinnedByLeader, pinnedByExp] = await Promise.all([
		db.select({ id: deliveries.id }).from(deliveries).where(and(isNotNull(deliveries.pinnedAt), isNull(deliveries.deletedAt), inArray(deliveries.leaderId, leaderIds.length ? leaderIds : [-1]))),
		db.select({ id: deliveries.id }).from(deliveries).where(and(isNotNull(deliveries.pinnedAt), isNull(deliveries.deletedAt), inArray(deliveries.experienceId, experienceIds.length ? experienceIds : [-1])))
	]);
	if (pinnedByLeader.length + pinnedByExp.length >= MAX_PINNED_DELIVERIES) {
		return { ok: false as const, error: `You can only pin up to ${MAX_PINNED_DELIVERIES} deliveries — unpin one first.` };
	}
	await db.update(deliveries).set({ pinnedAt: new Date() }).where(eq(deliveries.id, id));
	return { ok: true as const };
}
