import { fail } from '@sveltejs/kit';
import { requireLeader } from '$lib/server/dashboard';
import {
	listReviewPillarOptions,
	listReviewsForModeration,
	respondToReview,
	setReviewFlag,
	REVIEW_FLAG_REASONS,
	type ReviewFlagReason
} from '$lib/server/reviews';
import { listLeaderChats, replyToChat } from '$lib/server/chat';
import { getPageSize } from '$lib/server/settings';
import { getRunCampaign } from '$lib/server/leader';
import type { Actions, PageServerLoad } from './$types';

// "Respond" tab: the two places a leader/manager answers citizens — the AI chat
// threads (left) and review moderation (right) — shown side by side, each with
// its own page cursor (chatsPage / reviewsPage) so paging one never resets the
// other.
export const load: PageServerLoad = async (event) => {
	// Re-run on invalidate('chat:thread') — the SSE ping's refresh hook, so a
	// citizen's new question appears in the Chats list without a refresh.
	event.depends('chat:thread');
	const { ctx } = await requireLeader(event);
	const pageSize = await getPageSize();
	const reviewsPage = Math.max(1, Number(event.url.searchParams.get('reviewsPage') ?? 1));
	const chatsPage = Math.max(1, Number(event.url.searchParams.get('chatsPage') ?? 1));

	// Review pillar options come from the person's run this cycle (2027 campaign).
	const run = await getRunCampaign(ctx.profileUser.id);
	const [{ reviews, total: reviewTotal }, pillarOptions, { threads, total: chatTotal }] = await Promise.all([
		listReviewsForModeration(ctx.profileUser.id, reviewsPage, pageSize),
		listReviewPillarOptions(run?.id ?? 0),
		listLeaderChats(ctx.profileUser.id, chatsPage, pageSize)
	]);

	return {
		reviews,
		reviewTotal,
		reviewsPage,
		pillarOptions,
		flagReasons: REVIEW_FLAG_REASONS,
		threads,
		chatTotal,
		chatsPage,
		pageSize,
		// The person whose chats these are (users.id) — the SSE stream keys on this.
		chatPersonId: ctx.profileUser.id
	};
};

export const actions: Actions = {
	flag: async (event) => {
		const { ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const reviewId = Number(form.get('reviewId'));
		const reason = String(form.get('reason') ?? '');
		if (!reviewId) return fail(400, { error: 'Review not found.' });
		if (!REVIEW_FLAG_REASONS.includes(reason as ReviewFlagReason)) {
			return fail(400, { error: 'Pick a reason to flag this review.' });
		}
		await setReviewFlag(ctx.profileUser.id, reviewId, reason as ReviewFlagReason);
		return { moderated: true };
	},

	unflag: async (event) => {
		const { ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const reviewId = Number(form.get('reviewId'));
		if (!reviewId) return fail(400, { error: 'Review not found.' });
		await setReviewFlag(ctx.profileUser.id, reviewId, null);
		return { moderated: true };
	},

	respond: async (event) => {
		const { domainUser, ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const reviewId = Number(form.get('reviewId'));
		const body = String(form.get('body') ?? '').trim();
		if (!reviewId || !body) return fail(400, { error: 'Write a response first.' });

		const ok = await respondToReview(ctx.profileUser.id, ctx.leader?.id ?? 0, reviewId, ctx.role, domainUser.id, body);
		if (!ok) return fail(400, { error: 'Review not found.' });
		return { responded: true };
	},

	reply: async (event) => {
		const { domainUser, ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const conversationId = Number(form.get('conversationId'));
		const body = String(form.get('body') ?? '').trim();
		if (!conversationId || !body) return fail(400, { error: 'Write a reply first.' });

		const ok = await replyToChat(ctx.profileUser.id, conversationId, ctx.role, domainUser.id, body);
		if (!ok) return fail(400, { error: 'Conversation not found.' });
		return { replied: true };
	}
};
