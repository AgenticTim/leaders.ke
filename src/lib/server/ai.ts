// AI constituent chat: answers questions grounded in a leader's profile,
// manifesto and public posts. Uses the Claude API when ANTHROPIC_API_KEY is
// set; otherwise a keyword-match fallback keeps the feature testable in dev.
import { env } from '$env/dynamic/private';
import Anthropic from '@anthropic-ai/sdk';
import { getPlatformSettings } from '$lib/server/settings';

export type LeaderGrounding = {
	name: string;
	positionTitle: string;
	regionLabel: string;
	status: string;
	bio: string;
	pillars: { title: string; summary: string; deliveryStatus?: string; evidence?: string | null }[];
	posts: { title: string; body: string }[];
	// Knowledge tab (see $lib/server/knowledge.ts) — a team-curated FAQ plus
	// extracted text from uploaded source documents. Optional: older call sites
	// that haven't been updated to fetch these still work, just with less grounding.
	faqs?: { question: string; answer: string }[];
	// url is set only for a link-sourced document (an external http(s) source, e.g.
	// a YouTube video or article — see $lib/server/knowledge.ts) so the AI can point
	// a citizen straight at it. Null for an uploaded file, which has no public URL.
	documents?: { title: string; text: string; url?: string | null }[];
};

export type ConstituentAnswer = {
	answer: string;
	source: 'ai' | 'heuristic';
};

// Anthropic's own account (ours, not the leader's) is out of credits — a
// platform-wide outage, not a per-leader one. Thrown instead of silently
// falling back to the heuristic answer (see answerConstituentQuestion) so the
// caller can surface it plainly rather than quietly degrading every answer
// platform-wide with no visibility into why.
export class PlatformOutOfCreditsError extends Error {}

// Per-question grounding cap (docs/ai-chat-costs.md), admin-editable as
// platformSettings.maxGroundingChars (Settings → AI Chat), default 50,000 —
// the figure the PAYG credit price is costed against. Without this, a
// leader's stored knowledgebase (gated separately, per plan, by the much
// bigger knowledgeMb cap — see knowledge/+page.server.ts) goes into the
// prompt unbounded on every single question, which is what actually blows
// past this per-question budget.
function groundingText(leader: LeaderGrounding, maxChars: number): string {
	const pillars = leader.pillars
		.map(
			(p, i) =>
				`${i + 1}. ${p.title} [${p.deliveryStatus ?? 'promised'}]: ${p.summary}${p.evidence ? ` Evidence: ${p.evidence}` : ''}`
		)
		.join('\n');
	const posts = leader.posts.map((p) => `- ${p.title}: ${p.body}`).join('\n');
	const faqs = (leader.faqs ?? []).map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');

	// Profile, manifesto, posts and FAQ: the identity of the leader, never
	// truncated — a citizen's basic "who is this person" answer must never go
	// missing because of an unrelated document upload.
	const core = [
		`Leader: ${leader.name}, ${leader.status} for ${leader.positionTitle}, ${leader.regionLabel}, Kenya.`,
		leader.bio ? `Bio: ${leader.bio}` : '',
		pillars ? `Manifesto pillars:\n${pillars}` : 'No manifesto published yet.',
		posts ? `Recent public updates:\n${posts}` : 'No public updates yet.',
		// FAQs take priority over free-form documents — a team member wrote these
		// answers exactly as they want a citizen to read them.
		faqs ? `Team-written FAQ (prefer this wording when it answers the question):\n${faqs}` : ''
	]
		.filter(Boolean)
		.join('\n\n');

	// Uploaded documents are the biggest and least essential contributor, so
	// they absorb the cap: whatever's left of the budget after core, however
	// much (or little, or none) that turns out to be. A hard character slice
	// (not word- or document-boundary-aware) is an accepted simplicity
	// trade-off for a first cut at this.
	const documentsBudget = Math.max(0, maxChars - core.length);
	const documents = (leader.documents ?? [])
		.map((d) => `--- ${d.title}${d.url ? ` (source: ${d.url})` : ''} ---\n${d.text}`)
		.join('\n\n')
		.slice(0, documentsBudget);

	return [core, documents ? `Source documents:\n${documents}` : '']
		.filter(Boolean)
		.join('\n\n')
		.slice(0, maxChars);
}

async function askClaude(leader: LeaderGrounding, question: string): Promise<string> {
	// Admin-editable on the Settings page (Settings → AI Chat): platformSystemPrompt
	// governs the assistant everywhere, leaderSystemPrompt layers on top for
	// per-leader answers specifically. See DEFAULT_PLATFORM_SYSTEM_PROMPT /
	// DEFAULT_LEADER_SYSTEM_PROMPT in schema.ts for what a fresh platform ships with.
	const settings = await getPlatformSettings();
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	let response;
	try {
		response = await client.messages.create({
			// Sonnet 5 over Opus: ~7-8x cheaper per message (roughly $9 vs $65 per 1000
			// messages at typical grounding-context lengths) for a feature that's already
			// instructed to answer in 200-300 characters — not worth Opus's premium here.
			model: 'claude-sonnet-5',
			max_tokens: 1024,
			thinking: { type: 'adaptive' },
			// Two cache breakpoints (docs/ai-chat-costs.md), not one: the platform +
			// leader system prompts are identical for every leader and every citizen
			// site-wide, so they stay warm almost permanently regardless of any one
			// leader's own traffic. Grounding is its own breakpoint on top of that
			// shared prefix since it's only stable per-leader (changes whenever that
			// leader edits their Knowledge tab/manifesto). 5m TTL (the default) refreshes
			// on every cache hit, so either block only re-writes at full price after a
			// true idle gap, not on a fixed schedule.
			system: [
				{ type: 'text', text: `${settings.platformSystemPrompt}\n\n${settings.leaderSystemPrompt}`, cache_control: { type: 'ephemeral' } },
				{ type: 'text', text: groundingText(leader, settings.maxGroundingChars), cache_control: { type: 'ephemeral' } }
			],
			messages: [{ role: 'user', content: question }]
		});
	} catch (err) {
		// Anthropic's documented shape for our account being out of credits: a 400
		// invalid_request_error whose message mentions the credit balance. No
		// dedicated error class for it, so this is a message-content check, not a
		// status-code one — the only reliable way the SDK currently exposes it.
		if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) {
			throw new PlatformOutOfCreditsError('The AI provider account is out of credits.');
		}
		throw err;
	}
	if (response.stop_reason === 'refusal') {
		return 'I can\'t help with that question. Try asking about the manifesto, track record or campaign updates.';
	}
	const textBlock = response.content.find((b) => b.type === 'text');
	return textBlock?.text ?? 'No answer available right now; please try again.';
}

// Dev fallback: rank FAQs/pillars/posts by word overlap with the question and quote
// the best matches. FAQs win when they match — a team member wrote that answer
// specifically for this question.
function heuristicAnswer(leader: LeaderGrounding, question: string): string {
	const words = question
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 3);

	const score = (text: string) =>
		words.reduce((n, w) => (text.toLowerCase().includes(w) ? n + 1 : n), 0);

	const bestFaq = [...(leader.faqs ?? [])]
		.map((f) => ({ f, s: score(`${f.question} ${f.answer}`) }))
		.sort((a, b) => b.s - a.s)[0];
	if (bestFaq && bestFaq.s > 0) return bestFaq.f.answer;

	const bestPillar = [...leader.pillars]
		.map((p) => ({ p, s: score(`${p.title} ${p.summary}`) }))
		.sort((a, b) => b.s - a.s)[0];
	const bestPost = [...leader.posts]
		.map((p) => ({ p, s: score(`${p.title} ${p.body}`) }))
		.sort((a, b) => b.s - a.s)[0];

	const parts: string[] = [];
	if (bestPillar && bestPillar.s > 0) {
		parts.push(
			`From the manifesto pillar "${bestPillar.p.title}": ${bestPillar.p.summary}`
		);
	}
	if (bestPost && bestPost.s > 0) {
		parts.push(`From a campaign update, "${bestPost.p.title}": ${bestPost.p.body}`);
	}
	if (parts.length === 0) {
		return `${leader.name}'s campaign has not published a position on that yet. Follow the campaign to ask the team directly and get updates.`;
	}
	return parts.join('\n\n');
}

export async function answerConstituentQuestion(
	leader: LeaderGrounding,
	question: string
): Promise<ConstituentAnswer> {
	if (env.ANTHROPIC_API_KEY) {
		try {
			return { answer: await askClaude(leader, question), source: 'ai' };
		} catch (err) {
			if (err instanceof PlatformOutOfCreditsError) throw err;
			console.error('AI answer failed, falling back to heuristic:', err);
		}
	}
	return { answer: heuristicAnswer(leader, question), source: 'heuristic' };
}

// ── Mention sentiment (TODO 7.2) ────────────────────────────────────────────

export type MentionSentiment = 'positive' | 'neutral' | 'negative';

// Heuristic fallback lexicon for keyless dev: crude, but it keeps the PR desk's
// sentiment surfaces testable without an API key. Kenyan-press verbs included.
const NEGATIVE_WORDS = /scandal|corrupt|probe|arrest|slam|blast|fraud|court|sued|impeach|critici[sz]|accus|attack|fail|loss|graft|misuse|crisis|protest|clash|fake|stolen|bribe|dismiss|reject|condemn|storm out|walked out|heckle/i;
const POSITIVE_WORDS = /launch|win|won|praise|commission|award|deliver|celebrat|endors|donat|unveil|boost|champion|honou?r|graduat|empower|support|open(s|ed) (a|the|new)|lauded|applaud/i;

function heuristicSentiment(text: string): MentionSentiment {
	const negative = NEGATIVE_WORDS.test(text);
	const positive = POSITIVE_WORDS.test(text);
	if (negative && !positive) return 'negative';
	if (positive && !negative) return 'positive';
	return 'neutral';
}

/** Classifies one news mention's tone TOWARD the named leader. Haiku (cheap,
 * one word out) when a key is set; the keyword heuristic otherwise or on any
 * API failure — sentiment must never make ingestion itself fail. */
export async function classifyMentionSentiment(leaderName: string, title: string, body: string): Promise<MentionSentiment> {
	const text = `${title}\n${body}`.slice(0, 2000);
	if (!env.ANTHROPIC_API_KEY) return heuristicSentiment(text);

	try {
		const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
		const response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 5,
			system:
				'You classify Kenyan political news coverage. Reply with exactly one word - positive, neutral, or negative - describing the tone of the article TOWARD the named politician (not the general mood of the story).',
			messages: [{ role: 'user', content: `Politician: ${leaderName}\n\nArticle:\n${text}` }]
		});
		const word = response.content.find((b) => b.type === 'text')?.text.trim().toLowerCase() ?? '';
		if (word.includes('positive')) return 'positive';
		if (word.includes('negative')) return 'negative';
		return 'neutral';
	} catch (err) {
		console.error('[news] sentiment classification failed, using heuristic:', err instanceof Error ? err.message : err);
		return heuristicSentiment(text);
	}
}
