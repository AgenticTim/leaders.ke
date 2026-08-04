// Platform inbox (plans/10-platform-wide-ai-chat.md): the site-wide Ask box's
// threads. A platform question that couldn't be answered by AI — the asker was
// over their limit, or answering failed — is recorded and targeted at a human,
// so it lands here instead of dead-ending the citizen. Same shape as a
// campaign's own Chats list, but scoped to the platform (conversations.scope
// 'platform', scopeId null) and readable only by admins.
import { requireAdmin } from '$lib/server/dashboard';
import { getConversationOwnerId, listLeaderChats, replyToChat } from '$lib/server/chat';
import { adminActionFailed, notifyUser } from '$lib/server/notifications';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// Re-run on invalidate('chat:thread') so a new question appears without a refresh.
	event.depends('chat:thread');
	await requireAdmin(event);
	const pageSize = await getPageSize();
	const page = Math.max(1, Number(event.url.searchParams.get('page') ?? 1));
	const { threads, total } = await listLeaderChats(null, page, pageSize);
	return { threads, total, page, pageSize };
};

export const actions: Actions = {
	reply: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const conversationId = Number(form.get('conversationId'));
		const body = String(form.get('body') ?? '').trim();
		if (!conversationId || !body) return adminActionFailed(admin.domainUser.id, 400, { error: 'Write a reply first.' });

		// 'manager' is the sender kind for a non-AI, non-leader human reply — on a
		// platform thread that human is the platform team rather than a campaign's.
		const ok = await replyToChat(null, conversationId, 'manager', admin.domainUser.id, body);
		if (!ok) return adminActionFailed(admin.domainUser.id, 400, { error: 'Conversation not found.' });

		// The reply itself only lands in the thread, which the citizen sees when
		// their Ask panel is open (live via SSE) or next time they open it — so a
		// signed-in asker also gets the durable notification + email, otherwise a
		// reply to someone who has closed the tab reaches nobody. A guest thread
		// has no account and no email on file, so there's nothing to notify: their
		// reply waits in the panel for their return instead.
		const ownerId = await getConversationOwnerId(conversationId);
		if (ownerId) {
			await notifyUser(ownerId, {
				kind: 'platform-reply',
				title: 'vote.ke answered your question',
				body,
				href: '/',
				linkLabel: 'Open vote.ke and tap the sparkle to see the full thread'
			});
		}
		return { replied: true, notified: !!ownerId };
	}
};
