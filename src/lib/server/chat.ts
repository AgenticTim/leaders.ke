// Citizen chat persistence (TODO 8.2 + 10.1): the "Ask" box on a campaign page
// now records every question as a durable conversation/message thread instead
// of being a stateless single-shot. When the profile has AI Chat credit the
// question is answered immediately (an `ai` message); when it doesn't, the
// question is still captured and routed to the team, who reply from the
// dashboard Inbox, so no citizen question is ever silently dropped.
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

/** Matches a thread's scope: a leader thread keys on that PERSON's users.id,
 * a platform thread (the header's site-wide Ask) has no scopeId at all. */
function scopeMatch(personId: number | null) {
	return personId === null
		? and(eq(conversations.scope, 'platform'), isNull(conversations.scopeId))
		: and(eq(conversations.scope, 'leader'), eq(conversations.scopeId, personId));
}

/** The latest open web thread for this (scope, viewer), or a fresh one. A
 * viewer's follow-ups build one thread per LEADER the team can read in order,
 * signed-in citizens key on userId, guests on their anon_id device cookie (the
 * same thread on the profile and campaign pages, since both key on the person,
 * and never mixed across leaders, since scopeId differs). Scope 'leader' keys
 * on the PERSON (users.id), matching how reviews.ts and the RAG scopes key
 * conversations; `personId` null is the platform-wide thread instead (scopeId
 * null), one per viewer across the whole site rather than per leader. */
export async function getOrCreateWebConversation(
	personId: number | null,
	viewerId: number | null,
	anonId: string | null,
	ipAddress: string | null = null
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
			.where(and(scopeMatch(personId), eq(conversations.channel, 'web'), identity))
			.orderBy(desc(conversations.updatedAt))
			.limit(1);
		if (existing) {
			// Refresh the address on every ask rather than keeping only the one the
			// thread was opened from: the inboxes use it for abuse triage, where the
			// CURRENT address matters more than the first, and threads that predate
			// this column would otherwise stay blank forever.
			if (ipAddress) {
				await db.update(conversations).set({ ipAddress }).where(eq(conversations.id, existing.id));
			}
			return existing.id;
		}
	}
	const [created] = await db
		.insert(conversations)
		.values({
			scope: personId === null ? 'platform' : 'leader',
			scopeId: personId,
			channel: 'web',
			userId: viewerId,
			anonId,
			ipAddress
		})
		.returning({ id: conversations.id });
	return created.id;
}

/** The viewer's own chat history in one scope, for the public Ask block: every
 * message across their threads for this leader (older threads included, e.g.
 * pre-adoption guest ones), oldest first, or their platform-wide thread when
 * `personId` is null. Read-only, never creates a conversation, so plain page
 * loads stay write-free (adoption is the one exception: linking guest threads
 * to a fresh login IS the page-load moment). */
export async function getWebThread(
	personId: number | null,
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
		.where(and(scopeMatch(personId), eq(conversations.channel, 'web'), identity));
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

/** The tail of a thread, oldest-first, for feeding back as conversation context
 * on the next question, so "what about his rival?" resolves against what was
 * just discussed instead of being answered cold. */
export async function getRecentMessages(conversationId: number, limit: number): Promise<{ sender: string; body: string }[]> {
	const rows = await db
		.select({ sender: messages.sender, body: messages.body, id: messages.id })
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(desc(messages.id))
		.limit(limit);
	return rows.reverse().map((r) => ({ sender: r.sender, body: r.body }));
}

/** The signed-in citizen who owns this thread, or null for a guest thread
 * (identified only by an anon_id device cookie). Callers use it to decide
 * whether a reply can actually be delivered. A guest has no account to
 * notify and no email on file. */
export async function getConversationOwnerId(conversationId: number): Promise<number | null> {
	const [conv] = await db
		.select({ userId: conversations.userId })
		.from(conversations)
		.where(eq(conversations.id, conversationId));
	return conv?.userId ?? null;
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
	awaitingReply: boolean; // latest message is from the citizen, needs a team answer
	lastActivity: string;
	messages: ChatMessage[];
	// Guest identifiers, for telling one anonymous asker from another and for
	// abuse triage. Both null on a signed-in thread (the account name identifies
	// it), and both taken from the conversation itself. The address is the most
	// recent one the thread was used from (see conversations.ipAddress on why it
	// isn't read back from aiAskEvents).
	anonId: string | null;
	ipAddress: string | null;
};

/** Every citizen chat thread for this person (across seats), newest activity
 * first, each with its full message list. The dashboard Inbox reads this.
 * A thread needs attention when its last message came from the citizen.
 * `personId` null reads the PLATFORM-scope threads instead (the header's
 * site-wide Ask), which the admin platform inbox shows. */
export async function listLeaderChats(
	personId: number | null,
	page: number,
	pageSize: number
): Promise<{ threads: ChatThread[]; total: number }> {
	const scope = and(scopeMatch(personId), eq(conversations.channel, 'web'));

	const [{ total }] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(conversations)
		.where(scope);

	const convRows = await db
		.select({
			id: conversations.id,
			userId: conversations.userId,
			anonId: conversations.anonId,
			ipAddress: conversations.ipAddress,
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
		const isGuest = !c.userId;
		return {
			id: c.id,
			citizenName: c.firstName
				? fullName({ firstName: c.firstName, otherNames: c.otherNames ?? '' })
				: 'Guest',
			awaitingReply: last?.sender === 'follower',
			lastActivity: c.updatedAt.toISOString(),
			messages: msgs,
			anonId: isGuest ? c.anonId : null,
			ipAddress: isGuest ? c.ipAddress : null
		};
	});

	return { threads, total };
}

/** A team member's reply in a thread; guarded so only a conversation belonging
 * to this person can be answered. Returns false if the thread isn't theirs.
 * `personId` null replies in a PLATFORM-scope thread (admin platform inbox). */
export async function replyToChat(
	personId: number | null,
	conversationId: number,
	sender: 'leader' | 'manager',
	senderId: number,
	body: string
): Promise<boolean> {
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), scopeMatch(personId)));
	if (!conv) return false;

	await db.insert(messages).values({ conversationId, sender, senderId, body });
	await touchConversation(conversationId);
	await emitChatEvent(conversationId);
	return true;
}
