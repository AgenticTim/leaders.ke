// Broadcast queue + dispatcher (TODO #5.1/#5.2). A broadcast is composed once for
// a follower segment on one channel (email/SMS/WhatsApp); enqueue resolves the
// audience into `broadcast_recipients` rows and the dispatcher walks them, sending
// through the channel adapter, billing the campaign wallet for paid channels
// (email is free), and logging each row's outcome so a failure can be seen and
// retried by the sweep. Every message carries a one-click opt-out link (#5.3).
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { env as publicEnv } from '$env/dynamic/public';
import { db } from '$lib/server/db';
import { broadcastRecipients, broadcasts, followers, users } from '$lib/server/db/schema';
import { user as authUsers } from '$lib/server/db/auth.schema';
import { fullName } from '$lib/server/leader';
import { sendEmail } from '$lib/server/email';
import { sendSms } from '$lib/server/sms';
import { sendWhatsApp } from '$lib/server/whatsapp';
import { getBalance, refundCredits, spendCredits } from '$lib/server/credits';
import { getPlatformSettings } from '$lib/server/settings';

export type BroadcastChannel = 'email' | 'sms' | 'whatsapp';

/** Credits charged per recipient for a channel, read from admin-editable platform
 * settings (the same figures /pricing shows). Email is always free (SMTP), so it
 * has no setting. */
export async function channelCost(channel: BroadcastChannel): Promise<number> {
	if (channel === 'email') return 0;
	const s = await getPlatformSettings();
	return channel === 'sms' ? s.smsCostCredits : s.whatsappCostCredits;
}

type ResolvedRecipient = { followerId: number; destination: string; unsubscribeToken: string | null };

/** Reachable recipients for a segment on a channel: a live, confirmed, not-opted-out
 * follow with the channel opted in and a usable destination. Email falls back to
 * the linked account's address when the follow row itself carries none (account
 * follows store contact on the user, not the row); SMS/WhatsApp need a phone on
 * the row. */
async function resolveRecipients(
	subjectUserId: number,
	channel: BroadcastChannel,
	audience: string
): Promise<ResolvedRecipient[]> {
	const conditions = [
		eq(followers.digest, 'leader'),
		eq(followers.digestId, subjectUserId),
		isNull(followers.deletedAt),
		isNotNull(followers.confirmedAt),
		isNull(followers.optedOutAt),
		channel === 'email' ? eq(followers.email, true) : channel === 'sms' ? eq(followers.sms, true) : eq(followers.whatsapp, true)
	];
	const [kind, value] = audience.split(':');
	if (kind === 'county' && value) conditions.push(eq(followers.county, value));
	if (kind === 'ward' && value) conditions.push(eq(followers.ward, value));

	const rows = await db
		.select({
			id: followers.id,
			emailAddress: followers.emailAddress,
			phoneNumber: followers.phoneNumber,
			unsubscribeToken: followers.unsubscribeToken,
			accountEmail: authUsers.email
		})
		.from(followers)
		.leftJoin(users, eq(followers.userId, users.id))
		.leftJoin(authUsers, eq(users.authUserId, authUsers.id))
		.where(and(...conditions));

	const out: ResolvedRecipient[] = [];
	for (const r of rows) {
		let destination: string | null = null;
		if (channel === 'email') destination = r.emailAddress ?? r.accountEmail ?? null;
		else destination = r.phoneNumber ? r.phoneNumber.replace(/[^\d]/g, '') : null;
		if (destination) out.push({ followerId: r.id, destination, unsubscribeToken: r.unsubscribeToken });
	}
	return out;
}

/**
 * Enqueues a broadcast: resolves the audience, checks the wallet can cover a paid
 * channel up front, then writes the `broadcasts` head and one queued
 * `broadcast_recipients` row per recipient. Does not send, dispatchBroadcast does.
 */
export async function enqueueBroadcast(params: {
	subjectUserId: number;
	creatorId: number;
	channel: BroadcastChannel;
	subject: string | null;
	body: string;
	audience: string;
	audienceLabel: string;
}): Promise<{ ok: true; broadcastId: number; total: number } | { ok: false; error: string }> {
	const recipients = await resolveRecipients(params.subjectUserId, params.channel, params.audience);
	if (recipients.length === 0) return { ok: false, error: 'No reachable followers in that segment yet.' };

	const cost = (await channelCost(params.channel)) * recipients.length;
	if (cost > 0) {
		const balance = await getBalance(params.subjectUserId);
		if (balance < cost) {
			return { ok: false, error: `Needs ${cost} credits to reach ${recipients.length} on ${params.channel}; wallet has ${balance}.` };
		}
	}

	const [head] = await db
		.insert(broadcasts)
		.values({
			subjectUserId: params.subjectUserId,
			creatorId: params.creatorId,
			channel: params.channel,
			subject: params.subject,
			body: params.body,
			audienceLabel: params.audienceLabel,
			status: 'queued',
			totalRecipients: recipients.length
		})
		.returning({ id: broadcasts.id });

	// Backfill any missing opt-out tokens on the follow rows, then queue recipients.
	for (const r of recipients) {
		if (!r.unsubscribeToken) {
			r.unsubscribeToken = randomUUID().replace(/-/g, '');
			await db.update(followers).set({ unsubscribeToken: r.unsubscribeToken }).where(eq(followers.id, r.followerId));
		}
	}
	await db.insert(broadcastRecipients).values(
		recipients.map((r) => ({ broadcastId: head.id, followerId: r.followerId, channel: params.channel, destination: r.destination }))
	);

	return { ok: true, broadcastId: head.id, total: recipients.length };
}

function composeMessage(senderName: string, subject: string | null, body: string, optOutUrl: string, channel: BroadcastChannel) {
	if (channel === 'email') {
		return {
			subject: `${senderName}: ${subject ?? ''}`.trim(),
			text: `${body}\n\n----\nYou follow ${senderName} on vote.ke.\nOpt out: ${optOutUrl}`
		};
	}
	return { subject: '', text: `${senderName}: ${body}\n\nStop: ${optOutUrl}` };
}

/**
 * Sends every queued recipient of a broadcast, one at a time (fine at this scale).
 * Paid channels spend a credit before the send and refund it if the provider
 * throws, so a failed message is never billed. Idempotent per recipient: only
 * 'queued' rows are touched, so a re-run (sweep after a crash) resumes cleanly.
 */
export async function dispatchBroadcast(broadcastId: number): Promise<void> {
	const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
	if (!b || (b.status !== 'queued' && b.status !== 'sending')) return;

	await db.update(broadcasts).set({ status: 'sending' }).where(eq(broadcasts.id, broadcastId));

	const [subject] = await db.select().from(users).where(eq(users.id, b.subjectUserId));
	const senderName = subject ? fullName(subject) : 'vote.ke';
	const channel = b.channel as BroadcastChannel;
	const cost = await channelCost(channel);
	const reference = `broadcast:${broadcastId}`;
	const base = publicEnv.PUBLIC_BASE_URL ?? '';

	const queued = await db
		.select({ r: broadcastRecipients, token: followers.unsubscribeToken })
		.from(broadcastRecipients)
		.leftJoin(followers, eq(broadcastRecipients.followerId, followers.id))
		.where(and(eq(broadcastRecipients.broadcastId, broadcastId), eq(broadcastRecipients.status, 'queued')));

	for (const { r, token } of queued) {
		const now = new Date();
		// Spend before sending on paid channels; refund on failure below.
		if (cost > 0) {
			const spend = await spendCredits(b.subjectUserId, cost, channel, reference);
			if (!spend.ok) {
				await db
					.update(broadcastRecipients)
					.set({ status: 'failed', error: 'Insufficient credits', attempts: r.attempts + 1 })
					.where(eq(broadcastRecipients.id, r.id));
				continue;
			}
		}

		const optOutUrl = token ? `${base}/unsubscribe/${token}` : `${base}/`;
		const msg = composeMessage(senderName, b.subject, b.body, optOutUrl, channel);
		try {
			if (channel === 'email') await sendEmail({ to: r.destination, subject: msg.subject, text: msg.text });
			else if (channel === 'sms') await sendSms(r.destination, msg.text);
			else await sendWhatsApp(r.destination, msg.text);
			await db
				.update(broadcastRecipients)
				.set({ status: 'sent', sentAt: now, creditsSpent: cost, attempts: r.attempts + 1, error: null })
				.where(eq(broadcastRecipients.id, r.id));
		} catch (err) {
			if (cost > 0) await refundCredits(b.subjectUserId, cost, channel, `${reference}:refund`);
			await db
				.update(broadcastRecipients)
				.set({ status: 'failed', error: String(err).slice(0, 300), attempts: r.attempts + 1 })
				.where(eq(broadcastRecipients.id, r.id));
		}
	}

	// Recompute tallies from the recipient rows (covers this run plus any earlier).
	const finalRows = await db
		.select({ status: broadcastRecipients.status, creditsSpent: broadcastRecipients.creditsSpent })
		.from(broadcastRecipients)
		.where(eq(broadcastRecipients.broadcastId, broadcastId));
	const sentCount = finalRows.filter((x) => x.status === 'sent').length;
	const failedCount = finalRows.filter((x) => x.status === 'failed').length;
	const stillQueued = finalRows.some((x) => x.status === 'queued');
	const creditsSpent = finalRows.reduce((n, x) => n + x.creditsSpent, 0);
	const status = stillQueued ? 'sending' : sentCount === 0 ? 'failed' : failedCount > 0 ? 'partial' : 'sent';

	await db
		.update(broadcasts)
		.set({ sentCount, failedCount, creditsSpent, status, completedAt: stillQueued ? null : new Date() })
		.where(eq(broadcasts.id, broadcastId));
}

/** Crash recovery: re-dispatch any broadcast left mid-flight (still has queued
 * recipients). Called by the scheduler; safe to run anytime since dispatch only
 * touches queued rows. */
export async function sweepBroadcasts(): Promise<void> {
	const stuck = await db
		.select({ id: broadcasts.id })
		.from(broadcasts)
		.where(inArray(broadcasts.status, ['queued', 'sending']));
	for (const s of stuck) await dispatchBroadcast(s.id);
}
