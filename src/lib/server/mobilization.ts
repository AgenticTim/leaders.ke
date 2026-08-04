// Mobilization field work (TODO #17): an ambassador logs the events they run for
// a campaign and the citizen feedback they gather, and a manager confirms an
// event actually happened. Everything scopes to the PERSON mobilized for
// (subjectUserId), the same key ambassadors/managers use.
//
// Write guards split by role: ambassador writes go through isActiveAmbassador
// (they can only touch campaigns they mobilize for, and only their own rows);
// manager confirmation is done by whoever holds that person's dashboard, so the
// caller gates it with requireLeader and passes the resolved subjectUserId here.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { citizenFeedback, mobilizationEvents, users } from '$lib/server/db/schema';
import { fullName } from '$lib/server/leader';
import { isActiveAmbassador } from '$lib/server/ambassador';

export const EVENT_STATUSES = ['planned', 'held', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const FEEDBACK_SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type FeedbackSentiment = (typeof FEEDBACK_SENTIMENTS)[number];

export type MobilizationEvent = {
	id: number;
	title: string;
	description: string | null;
	county: string | null;
	ward: string | null;
	scheduledFor: string;
	status: EventStatus;
	turnout: number | null;
	confirmed: boolean;
	confirmedAt: string | null;
	ambassadorName: string; // who logged it (manager view leans on this)
};

export type FeedbackItem = {
	id: number;
	citizenName: string | null;
	county: string | null;
	ward: string | null;
	sentiment: FeedbackSentiment;
	message: string;
	createdAt: string;
	collectedByName: string; // who gathered it
};

type EventInput = {
	title: string;
	description: string;
	county: string | null;
	ward: string | null;
	scheduledFor: string; // ISO or datetime-local string
	turnout: string;
};

/** Logs an event for a campaign the caller actively mobilizes for. Returns the
 * new id, or a validation/authorization error. */
export async function createEvent(ambassadorUserId: number, subjectUserId: number, input: EventInput) {
	if (!(await isActiveAmbassador(ambassadorUserId, subjectUserId))) {
		return { ok: false as const, error: 'You can only log events for campaigns you mobilize for.' };
	}
	const title = input.title.trim();
	if (!title) return { ok: false as const, error: 'Give the event a title.' };
	const when = new Date(input.scheduledFor);
	if (Number.isNaN(when.getTime())) return { ok: false as const, error: 'Pick a valid date and time.' };
	const turnout = input.turnout.trim() ? Number(input.turnout) : null;
	if (turnout !== null && (!Number.isFinite(turnout) || turnout < 0)) {
		return { ok: false as const, error: 'Turnout must be a whole number.' };
	}

	const [row] = await db
		.insert(mobilizationEvents)
		.values({
			subjectUserId,
			ambassadorUserId,
			title,
			description: input.description.trim() || null,
			county: input.county,
			ward: input.ward || null,
			scheduledFor: when,
			// Past events default to 'held', future ones to 'planned'. The common case
			// either way, still editable.
			status: when.getTime() <= Date.now() ? 'held' : 'planned',
			turnout: turnout === null ? null : Math.round(turnout)
		})
		.returning({ id: mobilizationEvents.id });
	return { ok: true as const, id: row.id };
}

/** Manager confirms an event physically happened, scoped to their own campaign
 * (subjectUserId, resolved by requireLeader). No-op if the id isn't theirs. */
export async function confirmEvent(eventId: number, managerUserId: number, subjectUserId: number) {
	const now = new Date();
	await db
		.update(mobilizationEvents)
		.set({ confirmedBy: managerUserId, confirmedAt: now, status: 'held', updatedAt: now })
		.where(
			and(
				eq(mobilizationEvents.id, eventId),
				eq(mobilizationEvents.subjectUserId, subjectUserId),
				isNull(mobilizationEvents.deletedAt)
			)
		);
}

/** Ambassador removes one of their OWN events (soft delete, scoped to them). */
export async function deleteOwnEvent(eventId: number, ambassadorUserId: number) {
	await db
		.update(mobilizationEvents)
		.set({ deletedAt: new Date() })
		.where(and(eq(mobilizationEvents.id, eventId), eq(mobilizationEvents.ambassadorUserId, ambassadorUserId)));
}

/** Events this ambassador logged for this campaign, newest scheduled first. */
export async function listEventsForAmbassador(ambassadorUserId: number, subjectUserId: number): Promise<MobilizationEvent[]> {
	const rows = await db
		.select({ e: mobilizationEvents, u: users })
		.from(mobilizationEvents)
		.innerJoin(users, eq(mobilizationEvents.ambassadorUserId, users.id))
		.where(
			and(
				eq(mobilizationEvents.ambassadorUserId, ambassadorUserId),
				eq(mobilizationEvents.subjectUserId, subjectUserId),
				isNull(mobilizationEvents.deletedAt)
			)
		)
		.orderBy(desc(mobilizationEvents.scheduledFor));
	return rows.map(toEvent);
}

/** Every ambassador's events for this campaign. The manager confirmation feed. */
export async function listEventsForManager(subjectUserId: number): Promise<MobilizationEvent[]> {
	const rows = await db
		.select({ e: mobilizationEvents, u: users })
		.from(mobilizationEvents)
		.innerJoin(users, eq(mobilizationEvents.ambassadorUserId, users.id))
		.where(and(eq(mobilizationEvents.subjectUserId, subjectUserId), isNull(mobilizationEvents.deletedAt)))
		.orderBy(desc(mobilizationEvents.scheduledFor));
	return rows.map(toEvent);
}

function toEvent(r: { e: typeof mobilizationEvents.$inferSelect; u: typeof users.$inferSelect }): MobilizationEvent {
	return {
		id: r.e.id,
		title: r.e.title,
		description: r.e.description,
		county: r.e.county,
		ward: r.e.ward,
		scheduledFor: r.e.scheduledFor.toISOString(),
		status: r.e.status,
		turnout: r.e.turnout,
		confirmed: !!r.e.confirmedAt,
		confirmedAt: r.e.confirmedAt?.toISOString() ?? null,
		ambassadorName: fullName(r.u)
	};
}

/** Logs a piece of citizen feedback for a campaign the caller mobilizes for. */
export async function createFeedback(
	collectedByUserId: number,
	subjectUserId: number,
	input: { citizenName: string; county: string | null; ward: string | null; sentiment: string; message: string; eventId: number | null }
) {
	if (!(await isActiveAmbassador(collectedByUserId, subjectUserId))) {
		return { ok: false as const, error: 'You can only log feedback for campaigns you mobilize for.' };
	}
	const message = input.message.trim();
	if (!message) return { ok: false as const, error: 'Enter what the citizen said.' };
	const sentiment = FEEDBACK_SENTIMENTS.includes(input.sentiment as FeedbackSentiment)
		? (input.sentiment as FeedbackSentiment)
		: 'neutral';

	await db.insert(citizenFeedback).values({
		subjectUserId,
		collectedByUserId,
		eventId: input.eventId,
		citizenName: input.citizenName.trim() || null,
		county: input.county,
		ward: input.ward || null,
		sentiment,
		message
	});
	return { ok: true as const };
}

/** Feedback this ambassador gathered for this campaign, newest first. */
export async function listFeedbackForAmbassador(collectedByUserId: number, subjectUserId: number): Promise<FeedbackItem[]> {
	const rows = await db
		.select({ f: citizenFeedback, u: users })
		.from(citizenFeedback)
		.innerJoin(users, eq(citizenFeedback.collectedByUserId, users.id))
		.where(
			and(
				eq(citizenFeedback.collectedByUserId, collectedByUserId),
				eq(citizenFeedback.subjectUserId, subjectUserId),
				isNull(citizenFeedback.deletedAt)
			)
		)
		.orderBy(desc(citizenFeedback.createdAt));
	return rows.map(toFeedback);
}

/** Every ambassador's feedback for this campaign. The manager feed. */
export async function listFeedbackForManager(subjectUserId: number): Promise<FeedbackItem[]> {
	const rows = await db
		.select({ f: citizenFeedback, u: users })
		.from(citizenFeedback)
		.innerJoin(users, eq(citizenFeedback.collectedByUserId, users.id))
		.where(and(eq(citizenFeedback.subjectUserId, subjectUserId), isNull(citizenFeedback.deletedAt)))
		.orderBy(desc(citizenFeedback.createdAt));
	return rows.map(toFeedback);
}

function toFeedback(r: { f: typeof citizenFeedback.$inferSelect; u: typeof users.$inferSelect }): FeedbackItem {
	return {
		id: r.f.id,
		citizenName: r.f.citizenName,
		county: r.f.county,
		ward: r.f.ward,
		sentiment: r.f.sentiment,
		message: r.f.message,
		createdAt: r.f.createdAt.toISOString(),
		collectedByName: fullName(r.u)
	};
}
