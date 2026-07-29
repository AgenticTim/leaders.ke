// Subscription lifecycle sweep, run on a timer from hooks.server.ts: reminds
// payers ahead of expiry, then marks past-due subscriptions expired (which is
// what actually downgrades them — every tier gate reads only status='active').
// Each email is stamped on the subscription row (renewalReminderSentAt /
// expiryNotifiedAt), so the sweep is idempotent however often it runs.
import { and, eq, gte, isNull, lt, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { subscriptions, users } from '$lib/server/db/schema';
import { fullName } from '$lib/server/leader';
import { notifyUser } from '$lib/server/notifications';

/** How far ahead of endsAt the renewal reminder goes out. */
const REMINDER_DAYS = 7;

const dateLabel = (d: Date) => d.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' });
const tierLabel = (tier: string) => tier.charAt(0).toUpperCase() + tier.slice(1);

async function subjectName(subjectUserId: number): Promise<string> {
	const [subject] = await db.select({ firstName: users.firstName, otherNames: users.otherNames, slug: users.slug }).from(users).where(eq(users.id, subjectUserId));
	return subject ? fullName(subject) : 'your profile';
}

export async function runSubscriptionSweep(): Promise<{ reminded: number; expired: number }> {
	const now = new Date();
	const reminderHorizon = new Date(now.getTime() + REMINDER_DAYS * 24 * 60 * 60 * 1000);

	// 1) Renewal reminders: active, ending within the horizon, not yet reminded.
	const dueForReminder = await db
		.select()
		.from(subscriptions)
		.where(
			and(
				eq(subscriptions.status, 'active'),
				gte(subscriptions.endsAt, now),
				lte(subscriptions.endsAt, reminderHorizon),
				isNull(subscriptions.renewalReminderSentAt)
			)
		);
	for (const sub of dueForReminder) {
		// Stamp first: if the notification email throws mid-loop, the next sweep
		// must not double-send to everyone before the failure point.
		await db.update(subscriptions).set({ renewalReminderSentAt: now, updatedAt: now }).where(eq(subscriptions.id, sub.id));
		const name = await subjectName(sub.subjectUserId);
		await notifyUser(sub.payerId, {
			kind: 'claim',
			title: `Your ${tierLabel(sub.tier)} subscription ends ${dateLabel(sub.endsAt)}`,
			body: `${name}'s ${tierLabel(sub.tier)} plan (${sub.billingCycle}) ends on ${dateLabel(sub.endsAt)}. Renew before then to keep the campaign dashboard and public features uninterrupted.`,
			href: '/dashboard/account',
			linkLabel: 'Renew from your account'
		});
	}

	// 2) Expiry: active but past endsAt — flip to expired and tell the payer once.
	const pastDue = await db
		.select()
		.from(subscriptions)
		.where(and(eq(subscriptions.status, 'active'), lt(subscriptions.endsAt, now)));
	for (const sub of pastDue) {
		await db.update(subscriptions).set({ status: 'expired', expiryNotifiedAt: now, updatedAt: now }).where(eq(subscriptions.id, sub.id));
		const name = await subjectName(sub.subjectUserId);
		await notifyUser(sub.payerId, {
			kind: 'claim',
			title: `Your ${tierLabel(sub.tier)} subscription has expired`,
			body: `${name}'s ${tierLabel(sub.tier)} plan expired on ${dateLabel(sub.endsAt)}. The profile stays public, but package features are limited until you renew.`,
			href: '/dashboard/account',
			linkLabel: 'Renew from your account'
		});
	}

	return { reminded: dueForReminder.length, expired: pastDue.length };
}
