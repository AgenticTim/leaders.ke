// Platform-wide Ask (plans/10-platform-wide-ai-chat.md): the header's sparkle
// button posts here. An API endpoint rather than a form action because the Ask
// panel is mounted in the shared Header, so it has no page of its own to own
// the action — every route on the site would otherwise need to re-declare it.
//
//   GET   → the viewer's own platform thread (history survives refresh)
//   POST  → { question } → records it, answers it, returns the answer
//
// Every question is persisted as a platform-scope conversation whether or not
// it gets an AI answer, so an over-limit or unanswerable one lands in the admin
// platform inbox instead of dead-ending the citizen.
import { json } from '@sveltejs/kit';
import { getAnonId, getOrMintAnonId } from '$lib/server/anonId';
import { answerPlatformQuestion, PlatformOutOfCreditsError } from '$lib/server/ai';
import { enforceAskRateLimit } from '$lib/server/aiRateLimit';
import type { ChatTurn } from '$lib/server/ai';
import { getOrCreateWebConversation, getRecentMessages, getWebThread, recordAiAnswer, recordQuestion, routeQuestionToTeam } from '$lib/server/chat';
import { getDomainUser } from '$lib/server/leader';
import { platformGroundingText, routePlatformQuestion } from '$lib/server/platformAsk';
import { getPlatformSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/** Thread senders mapped to Anthropic roles: the citizen is the user; the AI
 * and any human platform reply both speak as the assistant, since from the
 * citizen's side they're the same voice answering them. */
function toTurns(rows: { sender: string; body: string }[]): ChatTurn[] {
	return rows.map((r) => ({ role: r.sender === 'follower' ? ('user' as const) : ('assistant' as const), content: r.body }));
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;
	// Read-only: never mints an anon_id, so simply opening the panel doesn't
	// set a cookie on a visitor who hasn't asked anything yet.
	const thread = await getWebThread(null, viewer?.id ?? null, getAnonId(cookies));
	// maxChars rides along so the panel can enforce the same cap the POST does,
	// without hardcoding a number that's admin-editable.
	const { askMaxChars } = await getPlatformSettings();
	return json({ ...thread, maxChars: askMaxChars });
};

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const raw = String(body.question ?? '').trim();
	if (raw.length < 5) return json({ error: 'Ask a question of at least a few words.' }, { status: 400 });

	// Truncated, not rejected: an over-long question still gets answered on its
	// first askMaxChars. Enforced here rather than trusting the textarea's own
	// maxlength, which a direct POST bypasses — this is the boundary that keeps
	// an arbitrarily large paste out of a billed Anthropic call.
	const settings = await getPlatformSettings();
	const question = raw.slice(0, settings.askMaxChars);
	const truncated = raw.length > question.length;

	const viewer = event.locals.user ? await getDomainUser(event.locals.user.id) : null;
	const rateLimit = await enforceAskRateLimit(event, viewer?.id ?? null);
	if (!rateLimit.ok) return json({ error: rateLimit.error }, { status: 429 });

	// getClientAddress throws when the adapter can't determine one — the thread
	// is worth far more than the address, so a failure just leaves it null.
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	const conversationId = await getOrCreateWebConversation(null, viewer?.id ?? null, getOrMintAnonId(event.cookies), ip);

	// Free AI answers spent (guest only — a signed-in citizen over their daily
	// quota gets a 429 above instead). The question is still captured and routed
	// to the platform inbox, but `reason` lets the client say plainly that the
	// free allowance is used up and signing in is how to get more, rather than
	// implying the AI is broken.
	if (rateLimit.teamOnly) {
		await recordQuestion(conversationId, viewer?.id ?? null, question, true);
		return json({ answered: false, answer: null, reason: 'guest-limit' });
	}

	// Read the thread BEFORE recording this question, so history is strictly what
	// came before it and the new question isn't duplicated as both context and
	// the live turn. Bounded by askHistoryMessages so a long thread never grows
	// the prompt (and its per-question cost) without limit.
	const prior = await getRecentMessages(conversationId, settings.askHistoryMessages);

	const messageId = await recordQuestion(conversationId, viewer?.id ?? null, question, false);

	try {
		const grounding = await routePlatformQuestion(
			question,
			{
				county: viewer?.county ?? null,
				constituency: viewer?.constituency ?? null,
				ward: viewer?.ward ?? null
			},
			prior.filter((m) => m.sender === 'follower').map((m) => m.body)
		);
		const answer = await answerPlatformQuestion(
			question,
			platformGroundingText(grounding, settings.maxGroundingChars),
			toTurns(prior)
		);
		// No API key configured: nothing to answer with, so the recorded question
		// becomes a human one rather than returning an empty answer.
		if (answer === null) {
			await routeQuestionToTeam(messageId);
			return json({ answered: false, answer: null, reason: 'unavailable' });
		}
		await recordAiAnswer(conversationId, answer);
		return json({ answered: true, answer, truncated });
	} catch (err) {
		// Out of credits, or any other answering failure: the question is already
		// recorded, so re-route it to the inbox and tell the citizen a human will
		// pick it up instead of surfacing a raw error.
		if (!(err instanceof PlatformOutOfCreditsError)) {
			console.error('[platform-ask] answering failed:', err instanceof Error ? err.message : err);
		}
		await routeQuestionToTeam(messageId);
		return json({ answered: false, answer: null, reason: 'unavailable' });
	}
};
