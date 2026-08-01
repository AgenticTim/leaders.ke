// Live chat delivery: a tiny in-process pubsub bridging message writes
// (chat.ts) to the open SSE connections (/api/chat/events), so a team reply
// shows up on the citizen's page — and a citizen question on the Respond tab —
// without a refresh. In-process matches how this app already runs its timers
// (hooks.server.ts) on the single PM2 fork; going multi-process would need
// Postgres LISTEN/NOTIFY here instead.
import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { conversations } from '$lib/server/db/schema';

export type ChatEvent = {
	personId: number; // the leader (conversations.scopeId) this thread belongs to
	conversationId: number;
	userId: number | null; // thread owner, for citizen-side filtering
	anonId: string | null;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per open SSE connection

/** Announces a new message in a conversation to every subscribed connection.
 * Looks the thread's identity up itself so callers only need the id. */
export async function emitChatEvent(conversationId: number): Promise<void> {
	const [conv] = await db
		.select({ scopeId: conversations.scopeId, userId: conversations.userId, anonId: conversations.anonId })
		.from(conversations)
		.where(eq(conversations.id, conversationId));
	if (!conv || conv.scopeId === null) return;
	emitter.emit('message', {
		personId: conv.scopeId,
		conversationId,
		userId: conv.userId,
		anonId: conv.anonId
	} satisfies ChatEvent);
}

export function subscribeChatEvents(fn: (e: ChatEvent) => void): () => void {
	emitter.on('message', fn);
	return () => emitter.off('message', fn);
}
