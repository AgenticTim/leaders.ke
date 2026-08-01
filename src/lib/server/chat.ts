// Citizen chat persistence (TODO 8.2 + 10.1): the "Ask" box on a campaign page
// now records every question as a durable conversation/message thread instead
// of being a stateless single-shot. When the profile has AI Chat credit the
// question is answered immediately (an `ai` message); when it doesn't, the
// question is still captured and routed to the team, who reply from the
// dashboard Inbox — so no citizen question is ever silently dropped.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { emitChatEvent } from '$lib/server/chatEvents';
import { db } from '$lib/server/db';
import { conversations, messages, users } from '$lib/server/db/schema';
import { fullName } from '$lib/server/leader';

/** Login linkage: every guest thread carrying this device's anon_id cookie is
 * adopted onto the now-signed-in citizen's account (across all leaders), so
 * chats started as a guest follow them into their account permanently. */
export async function adoptGuestConversations(viewerId: number, anonId: string): Promise<void> {
	await db
		.update(conversations)
		.set({ userId: viewerId })
		.where(and(eq(conversations.anonId, anonId), isNull(conversations.userId)));
}

/** The latest open web thread for this (person, viewer), or a fresh one. A
 * viewer's follow-ups build one thread per LEADER the team can read in order —
 * signed-in citizens key on userId, guests on their anon_id device cookie (the
 * same thread on the profile and campaign pages, since both key on the person,
 * and never mixed across leaders, since scopeId differs). Scope 'leader' keys
 * on the PERSON (users.id), matching how reviews.ts and the RAG scopes key
 * conversations. */
export async function getOrCreateWebConversation(
	personId: number,
	viewerId: number | null,
	anonId: string | null
): Promise<number> {
	if (viewerId !== null && anonId) await adoptGuestConversations(viewerId, anonId);
	const identity =
		viewerId !== null
			? eq(conversations.userId, viewerId)
			: anonId
				? and(eq(conversations.anonId, anonId), isNull(conversations.userId))
				: null;
	if (identity) {
		const [existing] = await db
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
		if (existing) return existing.id;
	}
	const [created] = await db
		.insert(conversations)
		.values({ scope: 'leader', scopeId: personId, channel: 'web', userId: viewerId, anonId })
		.returning({ id: conversations.id });
	return created.id;
}

/** The viewer's own chat history with this person, for the public Ask block:
 * every message across their threads for this leader (older threads included,
 * e.g. pre-adoption guest ones), oldest first. Read-only — never creates a
 * conversation, so plain page loads stay write-free (adoption is the one
 * exception: linking guest threads to a fresh login IS the page-load moment). */
export async function getWebThread(
	personId: number,
	viewerId: number | null,
	anonId: string | null
): Promise<{ messages: ChatMessage[]; awaitingReply: boolean }> {
	if (viewerId !== null && anonId) await adoptGuestConversations(viewerId, anonId);
	const identity =
		viewerId !== null
			? eq(conversations.userId, viewerId)
			: anonId
				? and(eq(conversations.anonId, anonId), isNull(conversations.userId))
				: null;
	if (!identity) return { messages: [], awaitingReply: false };

	const convRows = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.scope, 'leader'),
				eq(conversations.scopeId, personId),
				eq(conversations.channel, 'web'),
				identity
			)
		);
	if (convRows.length === 0) return { messages: [], awaitingReply: false };

	const msgRows = await db
		.select({
			id: messages.id,
			sender: messages.sender,
			body: messages.body,
			createdAt: messages.createdAt
		})
		.from(messages)
		.where(
			inArray(
				messages.conversationId,
				convRows.map((c) => c.id)
			)
		)
		.orderBy(asc(messages.createdAt));

	const list = msgRows.map((m) => ({
		id: m.id,
		sender: m.sender,
		body: m.body,
		createdAt: m.createdAt.toISOString()
	}));
	return { messages: list, awaitingReply: list[list.length - 1]?.sender === 'follower' };
}

async function touchConversation(conversationId: number): Promise<void> {
	await db
		.update(conversations)
		.set({ updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));
}

/** Records a citizen's question, returning the new message id. `awaitingTeam` =
 * true when no AI answer will follow (out of credit): the message is targeted
 * at the team so the Inbox surfaces it as needing a human reply. */
export async function recordQuestion(
	conversationId: number,
	viewerId: number | null,
	body: string,
	awaitingTeam: boolean
): Promise<number> {
	const [msg] = await db
		.insert(messages)
		.values({
			conversationId,
			sender: 'follower',
			senderId: viewerId,
			target: awaitingTeam ? 'manager' : null,
			body
		})
		.returning({ id: messages.id });
	await touchConversation(conversationId);
	await emitChatEvent(conversationId);
	return msg.id;
}

/** Re-routes an already-recorded question to the team (e.g. the platform ran
 * out of AI credits mid-answer, after the question was recorded expecting one). */
export async function routeQuestionToTeam(messageId: number): Promise<void> {
	await db.update(messages).set({ target: 'manager' }).where(eq(messages.id, messageId));
}

export async function recordAiAnswer(conversationId: number, body: string): Promise<void> {
	await db.insert(messages).values({ conversationId, sender: 'ai', body });
	await touchConversation(conversationId);
	await emitChatEvent(conversationId);
}

export type ChatMessage = { id: number; sender: string; body: string; createdAt: string };
export type ChatThread = {
	id: number;
	citizenName: string;
	awaitingReply: boolean; // latest message is from the citizen — needs a team answer
	lastActivity: string;
	messages: ChatMessage[];
};

/** Every citizen chat thread for this person (across seats), newest activity
 * first, each with its full message list — the dashboard Inbox reads this.
 * A thread needs attention when its last message came from the citizen. */
export async function listLeaderChats(
	personId: number,
	page: number,
	pageSize: number
): Promise<{ threads: ChatThread[]; total: number }> {
	const scope = and(
		eq(conversations.scope, 'leader'),
		eq(conversations.scopeId, personId),
		eq(conversations.channel, 'web')
	);

	const [{ total }] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(conversations)
		.where(scope);

	const convRows = await db
		.select({
			id: conversations.id,
			userId: conversations.userId,
			updatedAt: conversations.updatedAt,
			firstName: users.firstName,
			otherNames: users.otherNames
		})
		.from(conversations)
		.leftJoin(users, eq(conversations.userId, users.id))
		.where(scope)
		.orderBy(desc(conversations.updatedAt))
		.limit(pageSize)
		.offset((page - 1) * pageSize);

	if (convRows.length === 0) return { threads: [], total };

	const msgRows = await db
		.select({
			id: messages.id,
			conversationId: messages.conversationId,
			sender: messages.sender,
			body: messages.body,
			createdAt: messages.createdAt
		})
		.from(messages)
		.where(
			inArray(
				messages.conversationId,
				convRows.map((c) => c.id)
			)
		)
		.orderBy(messages.createdAt);

	const byConv = new Map<number, ChatMessage[]>();
	for (const m of msgRows) {
		const list = byConv.get(m.conversationId) ?? [];
		list.push({ id: m.id, sender: m.sender, body: m.body, createdAt: m.createdAt.toISOString() });
		byConv.set(m.conversationId, list);
	}

	const threads = convRows.map((c) => {
		const msgs = byConv.get(c.id) ?? [];
		const last = msgs[msgs.length - 1];
		return {
			id: c.id,
			citizenName: c.firstName
				? fullName({ firstName: c.firstName, otherNames: c.otherNames ?? '' })
				: 'Guest',
			awaitingReply: last?.sender === 'follower',
			lastActivity: c.updatedAt.toISOString(),
			messages: msgs
		};
	});

	return { threads, total };
}

/** A team member's reply in a thread; guarded so only a conversation belonging
 * to this person can be answered. Returns false if the thread isn't theirs. */
export async function replyToChat(
	personId: number,
	conversationId: number,
	sender: 'leader' | 'manager',
	senderId: number,
	body: string
): Promise<boolean> {
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.scope, 'leader'),
				eq(conversations.scopeId, personId)
			)
		);
	if (!conv) return false;

	await db.insert(messages).values({ conversationId, sender, senderId, body });
	await touchConversation(conversationId);
	await emitChatEvent(conversationId);
	return true;
}
