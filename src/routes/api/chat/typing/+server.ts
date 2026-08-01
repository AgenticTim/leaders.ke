// Transient typing signal, throttled client-side (~every 2s while typing) and
// broadcast to the other side's open SSE stream (/api/chat/events) — nothing
// is stored. Citizens signal for their own thread with a leader; team members
// signal into a specific conversation they manage.
//
//   POST { person }                  citizen typing in the Ask box — the
//                                    thread is resolved from their identity
//   POST { person, conversationId }  team typing a reply (Inbox) —
//                                    admin or active manager only
import { error, json } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getAnonId } from '$lib/server/anonId';
import { emitTypingEvent } from '$lib/server/chatEvents';
import { db } from '$lib/server/db';
import { conversations, managers } from '$lib/server/db/schema';
import { getDomainUser } from '$lib/server/leader';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const personId = Number(body.person ?? 0);
	const conversationId = Number(body.conversationId ?? 0);
	if (!personId) error(400, 'person is required');

	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;

	if (conversationId) {
		// Team side: must actually be on this person's team.
		const allowed =
			!!viewer &&
			(!!viewer.adminAt ||
				viewer.id === personId ||
				!!(
					await db
						.select({ id: managers.id })
						.from(managers)
						.where(
							and(
								eq(managers.userId, viewer.id),
								eq(managers.subjectUserId, personId),
								eq(managers.isActive, true),
								isNull(managers.deletedAt)
							)
						)
				)[0]);
		if (!allowed) error(403, 'Not a team member for this profile.');
		await emitTypingEvent(conversationId, 'team');
		return json({ ok: true });
	}

	// Citizen side: resolve THEIR thread with this leader from their identity —
	// the client never picks a conversation id, so it can't signal into
	// someone else's thread.
	const anonId = getAnonId(cookies);
	const identity =
		viewer !== null
			? eq(conversations.userId, viewer.id)
			: anonId
				? and(eq(conversations.anonId, anonId), isNull(conversations.userId))
				: null;
	if (!identity) return json({ ok: false }); // no thread yet — nothing to signal

	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.scope, 'leader'),
				eq(conversations.scopeId, personId),
				eq(conversations.channel, 'web'),
				identity
			)
		)
		.orderBy(desc(conversations.updatedAt))
		.limit(1);
	if (conv) await emitTypingEvent(conv.id, 'citizen');
	return json({ ok: !!conv });
};
