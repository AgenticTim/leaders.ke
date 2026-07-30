// Citizen chat persistence (TODO 8.2 + 10.1): the "Ask" box on a campaign page
// now records every question as a durable conversation/message thread instead
// of being a stateless single-shot. When the profile has AI Chat credit the
// question is answered immediately (an `ai` message); when it doesn't, the
// question is still captured and routed to the team, who reply from the
// dashboard Chats tab — so no citizen question is ever silently dropped.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { conversations, messages, users } from '$lib/server/db/schema';
import { fullName } from '$lib/server/leader';

/** The latest open web thread for this (person, viewer), or a fresh one. A
 * signed-in citizen's follow-ups build one thread the team can read in order;
 * anonymous visitors (no userId) always get a new thread since there's no
 * stable identity to group by. Scope 'leader' keys on the PERSON (users.id),
 * matching how reviews.ts and the RAG scopes key conversations. */
export async function getOrCreateWebConversation(
	personId: number,
	viewerId: number | null
): Promise<number> {
	if (viewerId !== null) {
		const [existing] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(
				and(
					eq(conversations.scope, 'leader'),
					eq(conversations.scopeId, personId),
					eq(conversations.userId, viewerId),
					eq(conversations.channel, 'web')
				)
			)
			.orderBy(desc(conversations.updatedAt))
			.limit(1);
		if (existing) return existing.id;
	}
	const [created] = await db
		.insert(conversations)
		.values({ scope: 'leader', scopeId: personId, channel: 'web', userId: viewerId })
		.returning({ id: conversations.id });
	return created.id;
}

async function touchConversation(conversationId: number): Promise<void> {
	await db
		.update(conversations)
		.set({ updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));
}

/** Records a citizen's question, returning the new message id. `awaitingTeam` =
 * true when no AI answer will follow (out of credit): the message is targeted
 * at the team so the Chats tab surfaces it as needing a human reply. */
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
 * first, each with its full message list — the dashboard Chats tab reads this.
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
	return true;
}
