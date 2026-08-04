// Durable per-user notifications: one call writes the in-app notification (bannered
// on the recipient's dashboard until dismissed) AND sends the matching email. Used
// for decisions that happen outside the recipient's own session — application
// approvals/rejections — where the flash cookie can't reach them. The email is
// transactional (it's about the recipient's own request), so it bypasses
// notificationPrefs, which gates broadcast-style noise, not decisions on things
// the user asked for.
import { fail, type ActionFailure } from '@sveltejs/kit';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications, users } from '$lib/server/db/schema';
import { user as authUsers } from '$lib/server/db/auth.schema';
import { sendEmail, stripLinks, toAbsoluteLinks } from '$lib/server/email';

export type NotificationInput = {
	// 'platform-reply': a vote.ke admin answered a question asked from the
	// header's site-wide Ask box (see the admin platform inbox). Transactional
	// like the rest — it answers something the citizen themselves asked.
	kind: 'verification' | 'claim' | 'moderation' | 'platform-reply';
	title: string;
	body: string; // includes the admin's reason on rejections; may embed its own
	// <a href="/relative-path">label</a> links (relative — same-origin in-app)
	href?: string; // the primary action link (relative path)
	linkLabel?: string; // anchor text for the auto-appended href link
};

/** Wraps fail() for an admin-console form action: records the same failure as
 * a durable 'admin-error' notification for the admin who hit it, then returns
 * the fail() the caller would have returned anyway — so a validation slip
 * during a fast editing session (e.g. Packages' many autosave cells) isn't
 * only a toast that can be missed, it's also sitting on /dashboard/notifications
 * until dismissed. No email (unlike notifyUser): this is a same-session UI
 * correction, not a decision that needs to reach the admin outside the tab. */
export async function adminActionFailed<T extends { error: string }>(
	adminUserId: number,
	status: number,
	data: T
): Promise<ActionFailure<T>> {
	await db.insert(notifications).values({ userId: adminUserId, kind: 'admin-error', title: 'Action failed', body: data.error });
	return fail(status, data);
}

/** The recipient's login email (better-auth user bridged via users.authUserId). */
async function emailFor(userId: number): Promise<string | null> {
	const [row] = await db
		.select({ email: authUsers.email })
		.from(users)
		.innerJoin(authUsers, eq(users.authUserId, authUsers.id))
		.where(eq(users.id, userId));
	return row?.email ?? null;
}

/**
 * Writes the in-app notification and emails the recipient the same content. The
 * href (if any) becomes a "Click here…" link appended to the body itself — stored
 * with a relative path (the dashboard's own @html render is same-origin), rewritten
 * to an absolute URL for the emailed copy (HTML, with a plain-text fallback for
 * clients that don't render it). Email failure is logged, never thrown — the
 * decision itself already committed, and the notification still surfaces on the
 * dashboard regardless.
 */
export async function notifyUser(userId: number, input: NotificationInput) {
	const label = input.linkLabel ?? 'Click here to access your dashboard';
	const body = input.href ? `${input.body}\n<a href="${input.href}">${label}</a>` : input.body;

	await db.insert(notifications).values({ userId, kind: input.kind, title: input.title, body, href: input.href ?? null });

	const to = await emailFor(userId);
	if (!to) return;
	const html = toAbsoluteLinks(body).replace(/\n/g, '<br>');
	try {
		await sendEmail({ to, subject: input.title, text: stripLinks(toAbsoluteLinks(body)), html });
	} catch (error) {
		console.error(`notification email to user ${userId} failed`, error);
	}
}

export type Notification = {
	id: number;
	kind: string;
	title: string;
	body: string;
	href: string | null;
	createdAt: string;
};

/** Unread notifications for the dashboard banner, oldest first so decisions read in order. */
export async function listUnreadNotifications(userId: number): Promise<Notification[]> {
	const rows = await db
		.select()
		.from(notifications)
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
		.orderBy(notifications.createdAt);
	return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: r.createdAt.toISOString() }));
}

/** Full notification history, newest first, for the Notifications tab — unlike
 * listUnreadNotifications this never filters on readAt (the tab is a permanent
 * record, nothing in it is ever dismissed). */
export async function listNotifications(
	userId: number,
	page: number,
	pageSize: number
): Promise<{ items: Notification[]; total: number }> {
	const [rows, [{ total }]] = await Promise.all([
		db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, userId))
			.orderBy(desc(notifications.createdAt))
			.limit(pageSize)
			.offset((page - 1) * pageSize),
		db.select({ total: count() }).from(notifications).where(eq(notifications.userId, userId))
	]);
	return {
		items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: r.createdAt.toISOString() })),
		total
	};
}

/** Unread count for the header's notification-button badge. */
export async function countUnreadNotifications(userId: number): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
	return row?.total ?? 0;
}

/** Dismisses notifications — only the caller's own, so one user can't clear another's. */
export async function markNotificationsRead(userId: number, ids: number[]) {
	if (ids.length === 0) return;
	await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt)));
}
