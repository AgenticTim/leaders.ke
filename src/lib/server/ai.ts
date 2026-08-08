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
	// Press mentions ingested from news sources (posts with a null creatorId,
	// linked through `tags`), NOT the leader's own words. Kept separate from
	// `posts` for exactly that reason: the prompt has to tell the model these are
	// journalists reporting, so it never answers "I said X" from a paraphrase or
	// recites hostile coverage as the campaign's own position. Optional, older
	// call sites keep working with less grounding.
	news?: { title: string; body: string; outlet: string | null; date: string }[];
	// Knowledge tab (see $lib/server/knowledge.ts). A team-curated FAQ plus
	// extracted text from uploaded source documents. Optional: older call sites
	// that haven't been updated to fetch these still work, just with less grounding.
	faqs?: { question: string; answer: string }[];
	// url is set only for a link-sourced document (an external http(s) source, e.g.
	// a YouTube video or article, see $lib/server/knowledge.ts) so the AI can point
	// a citizen straight at it. Null for an uploaded file, which has no public URL.
	documents?: { title: string; text: string; url?: string | null }[];
};

export type ConstituentAnswer = {
	answer: string;
	source: 'ai' | 'heuristic';
};

// Anthropic's own account (ours, not the leader's) is out of credits. A
// platform-wide outage, not a per-leader one. Thrown instead of silently
// falling back to the heuristic answer (see answerConstituentQuestion) so the
// caller can surface it plainly rather than quietly degrading every answer
// platform-wide with no visibility into why.
export class PlatformOutOfCreditsError extends Error {}

// Per-question grounding cap (docs/ai-chat-costs.md), admin-editable as
// platformSettings.maxGroundingChars (Settings → AI Chat), default 50,000.
// The figure the PAYG credit price is costed against. Without this, a
// leader's stored knowledgebase (gated separately, per plan, by the much
// bigger knowledgeMb cap, see knowledge/+page.server.ts) goes into the
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
	const news = (leader.news ?? [])
		.map((n) => `- ${n.date}${n.outlet ? ` · ${n.outlet}` : ''}: ${n.title}${n.body ? ` ${n.body}` : ''}`)
		.join('\n');

	// Profile, manifesto, posts and FAQ: the identity of the leader, never
	// truncated. A citizen's basic "who is this person" answer must never go
	// missing because of an unrelated document upload.
	const core = [
		`Leader: ${leader.name}, ${leader.status} for ${leader.positionTitle}, ${leader.regionLabel}, Kenya.`,
		leader.bio ? `Bio: ${leader.bio}` : '',
		pillars ? `Manifesto pillars:\n${pillars}` : 'No manifesto published yet.',
		posts ? `Recent public updates:\n${posts}` : 'No public updates yet.',
		// Explicitly framed as third-party reporting. Without this line the model
		// blends coverage into the leader's own voice, which on a hostile article
		// would put a journalist's characterisation in the campaign's mouth.
		news
			? `Recent press coverage mentioning ${leader.name}. These are news reports by OTHER people, not ${leader.name}'s own statements. You may say what was reported and by whom, but never present them as ${leader.name}'s words or position, and never repeat an allegation as fact:\n${news}`
			: '',
		// FAQs take priority over free-form documents. A team member wrote these
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

async function askClaude(leader: LeaderGrounding, question: string, history: ChatTurn[]): Promise<string> {
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
			// instructed to answer in 200-300 characters. Not worth Opus's premium here.
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
			// Recent turns first so follow-ups ("what about his record on that?")
			// resolve against the conversation rather than being answered cold.
			messages: [...normalizeHistory(history), { role: 'user', content: question }]
		});
	} catch (err) {
		// Anthropic's documented shape for our account being out of credits: a 400
		// invalid_request_error whose message mentions the credit balance. No
		// dedicated error class for it, so this is a message-content check, not a
		// status-code one. The only reliable way the SDK currently exposes it.
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
// the best matches. FAQs win when they match. A team member wrote that answer
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
	question: string,
	history: ChatTurn[] = []
): Promise<ConstituentAnswer> {
	if (env.ANTHROPIC_API_KEY) {
		try {
			return { answer: await askClaude(leader, question, history), source: 'ai' };
		} catch (err) {
			if (err instanceof PlatformOutOfCreditsError) throw err;
			console.error('AI answer failed, falling back to heuristic:', err);
		}
	}
	return { answer: heuristicAnswer(leader, question), source: 'heuristic' };
}

// ── Platform-wide chat (plans/10-platform-wide-ai-chat.md) ──────────────────

/** Answers a site-wide civic/platform question against whatever the retrieval
 * router pulled (platformAsk.ts), rather than one leader's knowledgebase.
 * Shares the platform system prompt with the per-leader chat but NOT the leader
 * one. Its instructions are about representing a single campaign, which is
 * wrong for a platform-scope answer. Throws PlatformOutOfCreditsError the same
 * way, so the caller can route the question to the platform inbox instead of
 * silently degrading. Returns null when there's no API key at all: unlike the
 * leader chat there's no useful keyword heuristic across this many different
 * source types, so the caller routes the question to a human instead. */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** Stored thread messages mapped to Anthropic roles: the citizen is the user;
 * the AI and any human reply (a campaign's team, or the platform's) both speak
 * as the assistant, since from the citizen's side they're the one voice
 * answering them. */
export function toChatTurns(rows: { sender: string; body: string }[]): ChatTurn[] {
	return rows.map((r) => ({
		role: r.sender === 'follower' ? ('user' as const) : ('assistant' as const),
		content: r.body
	}));
}

/** Anthropic requires the messages array to start with a user turn and to
 * alternate roles, but a real thread doesn't: a citizen can ask twice with no
 * answer in between (over their limit), and a thread can open with an admin
 * reply. Consecutive same-role turns are merged and any leading assistant
 * turns dropped, so real history can be replayed without a 400. */
function normalizeHistory(history: ChatTurn[]): ChatTurn[] {
	const merged: ChatTurn[] = [];
	for (const turn of history) {
		if (!turn.content.trim()) continue;
		const last = merged[merged.length - 1];
		if (last && last.role === turn.role) last.content += `\n\n${turn.content}`;
		else merged.push({ ...turn });
	}
	while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();
	return merged;
}

export async function answerPlatformQuestion(
	question: string,
	groundingText: string,
	history: ChatTurn[] = []
): Promise<string | null> {
	if (!env.ANTHROPIC_API_KEY) return null;
	const settings = await getPlatformSettings();
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	let response;
	try {
		response = await client.messages.create({
			model: 'claude-sonnet-5',
			max_tokens: 1024,
			thinking: { type: 'adaptive' },
			// Same two-breakpoint caching rationale as askClaude: the system prompt is
			// identical for every platform question site-wide so it stays warm, while
			// the retrieved grounding varies per question and sits after it.
			system: [
				{
					type: 'text',
					text: `${settings.platformSystemPrompt}\n\nYou are answering a PLATFORM-WIDE question: about Kenyan civics, elections, or how vote.ke itself works: not a question about one candidate. Ground every claim only in the retrieved material below. Where a source carries a URL or a site path (e.g. /pricing, /demographics), point the citizen to it so they can go deeper, write site paths exactly as given, starting with "/", never prefixed with a domain name. When the material genuinely doesn't answer the question, say so plainly and suggest the closest useful next step on vote.ke.`,
					cache_control: { type: 'ephemeral' }
				},
				{ type: 'text', text: groundingText, cache_control: { type: 'ephemeral' } }
			],
			// Recent turns first so follow-ups ("what about his rival?") resolve
			// against the conversation rather than being answered cold.
			messages: [...normalizeHistory(history), { role: 'user', content: question }]
		});
	} catch (err) {
		if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) {
			throw new PlatformOutOfCreditsError('The AI provider account is out of credits.');
		}
		throw err;
	}

	if (response.stop_reason === 'refusal') {
		return "I can't help with that one. Try asking about candidates, seats, elections, or how vote.ke works.";
	}
	return response.content.find((b) => b.type === 'text')?.text ?? null;
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

/** Classifies a BATCH of news mentions' tone TOWARD their named leader(s) in one
 * Haiku call instead of one call per post, with the ingested backlog now in the
 * thousands, one-call-per-post would mean thousands of sequential round trips.
 * `leaderName` may be several names joined ("A, B") for a post tagging more than
 * one person, matching how sentiment is stored: one value per POST, not per
 * tagged person. Falls back to the keyword heuristic per item, both when there's
 * no API key at all and per-item when the model's response is missing or
 * unparseable for that line, sentiment must never make ingestion itself fail. */
export async function classifyMentionSentimentBatch(items: { leaderName: string; title: string; body: string }[]): Promise<MentionSentiment[]> {
	const texts = items.map((it) => `${it.title}\n${it.body}`.slice(0, 1000));
	const heuristicResults = () => texts.map(heuristicSentiment);
	if (!env.ANTHROPIC_API_KEY) return heuristicResults();

	try {
		const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
		const prompt = items.map((it, i) => `${i + 1}. Politician: ${it.leaderName}\nArticle: ${texts[i]}`).join('\n\n');
		const response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: items.length * 10,
			system:
				'You classify Kenyan political news coverage. Below are several numbered articles. For EACH one, reply on its own line as "N: word" where word is positive, neutral, or negative. The tone of that article TOWARD its named politician (not the story\'s general mood). One line per article, in order, nothing else.',
			messages: [{ role: 'user', content: prompt }]
		});
		const text = response.content.find((b) => b.type === 'text')?.text ?? '';
		const results = heuristicResults(); // per-item fallback, overwritten below for each line the model actually answered
		for (const line of text.split('\n')) {
			const m = line.match(/^\s*(\d+)[:.]\s*(positive|neutral|negative)/i);
			if (!m) continue;
			const idx = Number(m[1]) - 1;
			if (idx >= 0 && idx < items.length) results[idx] = m[2].toLowerCase() as MentionSentiment;
		}
		return results;
	} catch (err) {
		console.error('[news] batch sentiment classification failed, using heuristic:', err instanceof Error ? err.message : err);
		return heuristicResults();
	}
}

/** A ~300-character plain-language digest of a leader's latest coverage, the
 * TL;DR line of the shareable WhatsApp brief (see $lib/server/leaderBrief.ts).
 * Haiku for speed and cost: the brief is generated on a copy click, so latency
 * is felt directly, and the output is short.
 *
 * Returns null rather than throwing on any failure (no API key, an error, an
 * empty reply). The brief is a template that the TL;DR only decorates, so a
 * model problem must degrade the message, never block the copy. */
export async function summarizeLeaderNews(
	leaderName: string,
	items: { title: string; body: string }[]
): Promise<string | null> {
	if (!env.ANTHROPIC_API_KEY || items.length === 0) return null;
	try {
		const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
		const prompt = items
			.map((it, i) => `${i + 1}. ${it.title}\n${it.body.slice(0, 500)}`)
			.join('\n\n');
		const response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 200,
			system:
				`You write a one-paragraph digest of recent Kenyan news coverage about ${leaderName}, for readers sharing it on WhatsApp. ` +
				'Summarize only what the articles below actually report, in at most 300 characters of plain prose. ' +
				'No preamble, no bullet points, no markdown, no headline repetition, no speculation about motives, no opinion on whether the coverage is fair. ' +
				'If the articles disagree or one is a fact-check, say so plainly. Reply with the paragraph only.',
			messages: [{ role: 'user', content: prompt }]
		});
		const text = response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
		if (!text) return null;
		// The model usually honors the 300-character brief; this is the guarantee,
		// since the whole message has a WhatsApp length budget to stay inside.
		return text.length > 300 ? `${text.slice(0, 297).trimEnd()}…` : text;
	} catch (err) {
		console.error('[brief] TL;DR generation failed, sending the brief without it:', err instanceof Error ? err.message : err);
		return null;
	}
}
