import { fail } from '@sveltejs/kit';
import { requireLeader } from '$lib/server/dashboard';
import { listLeaderChats, replyToChat } from '$lib/server/chat';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

// Chats tab (TODO 10.1): the team answers citizen questions the AI couldn't
// (out of credit) plus any that came in while credit was available — every
// "Ask" on a campaign/record page lands here as a thread. Threads whose last
// message is from the citizen are flagged as awaiting a reply.
export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	const pageSize = await getPageSize();
	const page = Math.max(1, Number(event.url.searchParams.get('page') ?? 1));

	const { threads, total } = await listLeaderChats(ctx.profileUser.id, page, pageSize);
	return { threads, total, page, pageSize };
};

export const actions: Actions = {
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
