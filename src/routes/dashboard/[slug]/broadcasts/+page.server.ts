import { fail } from '@sveltejs/kit';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { broadcasts, followers } from '$lib/server/db/schema';
import { requireLeader } from '$lib/server/dashboard';
import { dispatchBroadcast, enqueueBroadcast, type BroadcastChannel } from '$lib/server/broadcast';
import { getBalance } from '$lib/server/credits';
import { getPageSize, getPlatformSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

const CHANNELS: BroadcastChannel[] = ['email', 'sms', 'whatsapp'];

// Broadcasts: compose once, send to a geo segment on a chosen channel. Sends move
// through a queue (broadcasts + broadcast_recipients) with per-recipient delivery
// logging; SMS/WhatsApp bill the campaign credit wallet, email is free.
export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	const pageSize = await getPageSize();
	const page = Math.max(1, Number(event.url.searchParams.get('page') ?? 1));

	const target = and(eq(followers.digest, 'leader'), eq(followers.digestId, ctx.profileUser.id), isNull(followers.deletedAt));
	const historyFilter = and(eq(broadcasts.subjectUserId, ctx.profileUser.id), isNull(broadcasts.deletedAt));

	const [history, [{ n: total }], followerRows, balance, settings] = await Promise.all([
		db.select().from(broadcasts).where(historyFilter).orderBy(desc(broadcasts.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
		db.select({ n: count() }).from(broadcasts).where(historyFilter),
		db.select().from(followers).where(target),
		getBalance(ctx.profileUser.id),
		getPlatformSettings()
	]);

	// A row is reachable on a channel when it's confirmed, not opted out, opted in
	// to that channel, and has a usable destination (email can fall back to the
	// account address, so its count is a floor).
	const live = followerRows.filter((f) => f.confirmedAt && !f.optedOutAt);
	const reach = {
		email: live.filter((f) => f.email && (f.emailAddress || f.userId)).length,
		sms: live.filter((f) => f.sms && f.phoneNumber).length,
		whatsapp: live.filter((f) => f.whatsapp && f.phoneNumber).length
	};
	const wards = [...new Set(followerRows.map((f) => f.ward).filter(Boolean))].sort() as string[];
	const counties = [...new Set(followerRows.map((f) => f.county).filter(Boolean))].sort() as string[];

	return {
		broadcasts: history.map((b) => ({
			id: b.id,
			channel: b.channel,
			title: b.subject,
			body: b.body,
			summary: `${b.audienceLabel} · ${b.sentCount} sent${b.failedCount ? ` · ${b.failedCount} failed` : ''}${b.creditsSpent ? ` · ${b.creditsSpent} credits` : ''}`,
			status: b.status,
			sentAt: b.createdAt.toISOString()
		})),
		total,
		page,
		pageSize,
		balance,
		channelCost: { email: 0, sms: settings.smsCostCredits, whatsapp: settings.whatsappCostCredits } as Record<BroadcastChannel, number>,
		audience: { total: followerRows.length, reach, wards, counties }
	};
};

export const actions: Actions = {
	send: async (event) => {
		const { domainUser, ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const channel = String(form.get('channel') ?? 'email') as BroadcastChannel;
		const subject = String(form.get('subject') ?? '').trim();
		const body = String(form.get('body') ?? '').trim();
		const audience = String(form.get('audience') ?? 'all'); // 'all' | 'county:<v>' | 'ward:<v>'

		if (!CHANNELS.includes(channel)) return fail(400, { error: 'Pick a valid channel.' });
		if (!body) return fail(400, { error: 'A broadcast needs a message.' });
		if (channel === 'email' && !subject) return fail(400, { error: 'An email broadcast needs a subject.' });

		const [kind, value] = audience.split(':');
		const audienceLabel = kind === 'all' ? 'all followers' : `${kind}: ${value}`;

		const enqueued = await enqueueBroadcast({
			subjectUserId: ctx.profileUser.id,
			creatorId: domainUser.id,
			channel,
			subject: channel === 'email' ? subject : null,
			body,
			audience,
			audienceLabel
		});
		if (!enqueued.ok) return fail(400, { error: enqueued.error });

		// Send now; the sweep only exists to recover a crash mid-dispatch.
		await dispatchBroadcast(enqueued.broadcastId);
		return { sent: enqueued.total };
	}
};
