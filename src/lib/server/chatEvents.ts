// Live chat delivery: a tiny in-process pubsub bridging message writes
// (chat.ts) to the open SSE connections (/api/chat/events), so a team reply
// shows up on the citizen's page, and a citizen question on the Inbox,
// without a refresh. In-process matches how this app already runs its timers
// (hooks.server.ts) on the single PM2 fork; going multi-process would need
// Postgres LISTEN/NOTIFY here instead.
import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { conversations } from '$lib/server/db/schema';

export type ChatEvent = {
	kind: 'message' | 'typing';
	// The leader (conversations.scopeId) this thread belongs to, or null for a
	// platform-scope thread (the header's site-wide Ask, which has no scopeId).
	personId: number | null;
	conversationId: number;
	userId: number | null; // thread owner, for citizen-side filtering
	anonId: string | null;
	from: 'citizen' | 'team'; // typing only: which side's keyboard is active
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per open SSE connection

async function threadIdentity(conversationId: number) {
	const [conv] = await db
		.select({ scope: conversations.scope, scopeId: conversations.scopeId, userId: conversations.userId, anonId: conversations.anonId })
		.from(conversations)
		.where(eq(conversations.id, conversationId));
	// A leader thread must carry its scopeId; a platform thread legitimately has none.
	if (!conv) return null;
	return conv.scope === 'platform' || conv.scopeId !== null ? conv : null;
}

/** Announces a new message in a conversation to every subscribed connection.
 * Looks the thread's identity up itself so callers only need the id. */
export async function emitChatEvent(conversationId: number): Promise<void> {
	const conv = await threadIdentity(conversationId);
	if (!conv) return;
	emitter.emit('message', {
		kind: 'message',
		personId: conv.scopeId,
		conversationId,
		userId: conv.userId,
		anonId: conv.anonId,
		from: 'citizen'
	} satisfies ChatEvent);
}

/** Transient "someone is typing" signal (never stored). The other side shows
 * a typing indicator for a few seconds. */
export async function emitTypingEvent(conversationId: number, from: 'citizen' | 'team'): Promise<void> {
	const conv = await threadIdentity(conversationId);
	if (!conv) return;
	emitter.emit('message', {
		kind: 'typing',
		personId: conv.scopeId,
		conversationId,
		userId: conv.userId,
		anonId: conv.anonId,
		from
	} satisfies ChatEvent);
}

export function subscribeChatEvents(fn: (e: ChatEvent) => void): () => void {
	emitter.on('message', fn);
	return () => emitter.off('message', fn);
}
