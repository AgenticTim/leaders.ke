import { error, fail } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	campaigns,
	creditTransactions,
	pillars,
	pledges,
	posts,
	wallets
} from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, getDomainUser, resolveCurrentTerm } from '$lib/server/leader';
import { runStatus } from '$lib/utils/seat';
import { loadPublicProfileData } from '$lib/server/publicProfile';
import { followAsAccount, unfollowAsAccount } from '$lib/server/follow';
import { handleDeleteReviewAction, handleReviewAction } from '$lib/server/reviews';
import { PlatformOutOfCreditsError, answerConstituentQuestion, toChatTurns } from '$lib/server/ai';
import { enforceAskRateLimit } from '$lib/server/aiRateLimit';
import { enforceRateLimit, ipBucket } from '$lib/server/rateLimit';
import { getGroundingExtras } from '$lib/server/knowledge';
import { clientAddress, getOrMintAnonId } from '$lib/server/anonId';
import {
	getOrCreateWebConversation,
	getRecentMessages,
	getWebThread,
	recordAiAnswer,
	recordQuestion,
	routeQuestionToTeam
} from '$lib/server/chat';
import { getPlatformSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

// /[leader]: the permanent leader record, bio, verified track record across
// every seat they've held or are vying for, education/professional experience,
// and a pointer to the active campaign workspace at /[leader]/[year]. The bulk
// of the data-loading lives in $lib/server/publicProfile so admin previews
// (a pending application, a pending claim) can render the exact same shape.
export const load: PageServerLoad = async ({ params, locals, cookies, depends }) => {
	// Re-run on invalidate('chat:thread'). The SSE ping's refresh hook.
	depends('chat:thread');
	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;

	const data = await loadPublicProfileData(params.leader, {
		viewerId: viewer?.id,
		isAdmin: !!viewer?.adminAt
	});
	if (!data) error(404, 'Leader not found');

	// The viewer's existing pledge to this person's active run (by account, or
	// anon device cookie for a guest), so a refresh keeps showing "Pledged ✓".
	// Read-only here: minting a fresh anon_id is the pledge action's job.
	const anonId = cookies.get('anon_id') ?? null;
	let isPledged = false;
	if (data.leadCampaignId && (viewer || anonId)) {
		const [existingPledge] = await db
			.select({ id: pledges.id })
			.from(pledges)
			.where(
				and(
					eq(pledges.campaignId, data.leadCampaignId),
					isNull(pledges.deletedAt),
					viewer ? eq(pledges.userId, viewer.id) : eq(pledges.anonId, anonId!)
				)
			)
			.limit(1);
		isPledged = !!existingPledge;
	}

	// The viewer's own chat history with this person (questions, AI answers,
	// team replies), keyed by account or the guest's anon_id, so refreshing
	// never loses the thread and team replies actually reach the citizen.
	const chatThread = await getWebThread(data.subjectId, viewer?.id ?? null, anonId);

	// askMaxChars drives the Ask box's own maxlength. The action truncates to
	// it regardless, this just stops the textarea taking more than will be used.
	const { askMaxChars } = await getPlatformSettings();
	return { ...data, isPledged, chatThread, askMaxChars };
};

// Resolves a slug to its public review target: the person id, the lead campaign
// (for pillar validation) and enough context to ground an AI answer (seat, status,
// bio). Null when there's no held term or run at all.
async function publicLead(slug: string): Promise<{
	subjectId: number;
	leadCampaignId: number;
	name: string;
	positionTitle: string;
	regionLabel: string;
	status: string;
	bio: string;
} | null> {
	const resolved = await resolveCurrentTerm(slug);
	if (!resolved) return null;
	const { row, currentTerm, activeRun } = resolved;
	const leadsWithRun = (!currentTerm || currentTerm.leaders.status === 'former') && !!activeRun;
	if (!currentTerm && !activeRun) return null;
	let leadCampaignId = 0;
	if (leadsWithRun) {
		leadCampaignId = activeRun!.campaigns.id;
	} else if (currentTerm) {
		// Person+cycle scoped (subjectUserId), same key as an aspirant's activeRun,
		// leaderId on `campaigns` is only ever a nullable secondary link, never the
		// lookup key (seed-campaigns.ts never sets it).
		const [c] = await db
			.select({ id: campaigns.id })
			.from(campaigns)
			.where(
				and(
					eq(campaigns.subjectUserId, row.users.id),
					eq(campaigns.cycleYear, ACTIVE_CYCLE),
					isNull(campaigns.parentCampaignId),
					isNull(campaigns.deletedAt)
				)
			);
		leadCampaignId = c?.id ?? 0;
	}
	const position = leadsWithRun ? activeRun!.positions : currentTerm!.positions;
	const status = leadsWithRun ? runStatus(activeRun!.campaigns.verifiedAt) : currentTerm!.leaders.status;
	return {
		subjectId: row.users.id,
		leadCampaignId,
		name: fullName(row.users),
		positionTitle: position.title,
		regionLabel: position.region,
		status,
		bio: row.users.bio ?? ''
	};
}

export const actions: Actions = {
	// Signed-in only. The account itself is the proof, no name/contact capture
	// or OTP confirm needed (see followAsAccount).
	follow: async (event) => {
		if (!event.locals.user) return fail(401, { error: 'Log in to follow.' });
		const domainUser = await getDomainUser(event.locals.user.id);
		if (!domainUser) return fail(401, { error: 'Log in to follow.' });

		const lead = await publicLead(event.params.leader);
		if (!lead) return fail(404, { error: 'Leader not found.' });

		const result = await followAsAccount(domainUser.id, lead.subjectId);
		if (!result.ok) return fail(400, { error: result.error });
		return { followed: true };
	},

	unfollow: async (event) => {
		if (!event.locals.user) return fail(401, { error: 'Log in first.' });
		const domainUser = await getDomainUser(event.locals.user.id);
		if (!domainUser) return fail(401, { error: 'Log in first.' });

		const lead = await publicLead(event.params.leader);
		if (!lead) return fail(404, { error: 'Leader not found.' });

		await unfollowAsAccount(domainUser.id, lead.subjectId);
		return { unfollowed: true };
	},

	// Pledge a 2027 vote to this person's active run. A pledge is a named promise,
	// so it always requires a logged-in account (guests get the auth modal
	// client-side). The campaign is resolved server-side, never trusted from the form.
	pledge: async (event) => {
		if (!event.locals.user) return fail(401, { pledgeError: 'Log in to pledge.' });
		const domainUser = await getDomainUser(event.locals.user.id);
		if (!domainUser) return fail(401, { pledgeError: 'Log in to pledge.' });

		// Spam guard: cap per account and per IP even though pledging needs login.
		const limit = await enforceRateLimit('pledge', [ipBucket(event), `user:${domainUser.id}`]);
		if (!limit.ok) return fail(429, { pledgeError: 'Too many attempts. Please wait a minute and try again.' });

		const lead = await publicLead(event.params.leader);
		if (!lead?.leadCampaignId)
			return fail(400, { pledgeError: 'This campaign is not taking pledges yet.' });

		let ip: string | null = null;
		try {
			ip = event.getClientAddress();
		} catch {
			ip = null;
		}
		const userAgent = event.request.headers.get('user-agent')?.slice(0, 255) ?? null;

		// The partial unique index keeps one live pledge per (campaign, user); a
		// repeat submission just keeps the existing pledge.
		await db
			.insert(pledges)
			.values({ userId: domainUser.id, campaignId: lead.leadCampaignId, ip, userAgent })
			.onConflictDoNothing();

		return { pledged: true };
	},

	review: async (event) => {
		const lead = await publicLead(event.params.leader);
		if (!lead) error(404, 'Leader not found');
		return await handleReviewAction(event, lead.subjectId, lead.leadCampaignId);
	},

	deleteReview: async (event) => {
		const lead = await publicLead(event.params.leader);
		if (!lead) error(404, 'Leader not found');
		return await handleDeleteReviewAction(event, lead.subjectId);
	},

	// Same AI constituent chat as the campaign workspace's Ask block, grounded in
	// the same manifesto/posts, available here too so the permanent profile
	// doesn't need a live campaign workspace to answer a question.
	ask: async (event) => {
		const form = await event.request.formData();
		const raw = String(form.get('question') ?? '').trim();
		if (!raw || raw.length < 5) {
			return fail(400, { error: 'Ask a question of at least a few words.' });
		}

		// Truncated, not rejected: an over-long question still gets answered on
		// its first askMaxChars. Enforced server-side because the textarea's own
		// maxlength is bypassed by a direct POST. This is what actually keeps an
		// arbitrarily large paste out of a billed Anthropic call.
		const settings = await getPlatformSettings();
		const question = raw.slice(0, settings.askMaxChars);

		const viewer = event.locals.user ? await getDomainUser(event.locals.user.id) : null;
		const rateLimit = await enforceAskRateLimit(event, viewer?.id ?? null);
		if (!rateLimit.ok) return fail(429, { error: rateLimit.error });

		const lead = await publicLead(event.params.leader);
		if (!lead) return fail(404, { error: 'Leader not found.' });

		// AI chat is available on EVERY package. The wallet's credit balance is
		// the only gate. Low tiers taste the feature and buy credits; that's the
		// conversion path, so no tier check here.

		// Every question is captured as a durable thread regardless of credit (the
		// team answers the uncredited ones from the dashboard Chats tab), so nothing
		// a citizen asks is ever lost. Guests key on the anon_id device cookie
		// (minted here if needed) so their thread survives refresh.
		const conversationId = await getOrCreateWebConversation(
			lead.subjectId,
			viewer?.id ?? null,
			getOrMintAnonId(event.cookies),
			clientAddress(event)
		);

		// Free AI answers exhausted (guest): the question still lands, routed to
		// the team, never a "log in to keep asking" dead end.
		if (rateLimit.teamOnly) {
			await recordQuestion(conversationId, viewer?.id ?? null, question, true);
			return { asked: true, answered: false, question };
		}

		// Profile-scoped wallet gate (subjectId), not campaignId: the knowledgebase
		// a wallet pays to query is one per person, not per run. With no credit the
		// question is still recorded and routed to the team. A human replies later
		// rather than the citizen hitting a dead end.
		//
		// Platform admins pass this gate on any profile, funded or not (the
		// platform absorbs the call, and nothing is deducted below). Without the
		// exemption an admin can't exercise profile chat at all on the profiles
		// that need checking most: the unfunded ones.
		const [wallet] = await db
			.select()
			.from(wallets)
			.where(eq(wallets.subjectUserId, lead.subjectId));
		const platformAdmin = !!rateLimit.platformAdmin;
		if (!platformAdmin && (!wallet || wallet.balance < settings.aiChatCostCredits)) {
			await recordQuestion(conversationId, viewer?.id ?? null, question, true);
			return { asked: true, answered: false, question };
		}

		// Read the thread BEFORE recording this question, so history is strictly
		// what came before it and the new question isn't duplicated as both
		// context and the live turn. Bounded by askHistoryMessages.
		const prior = await getRecentMessages(conversationId, settings.askHistoryMessages);

		const questionMessageId = await recordQuestion(
			conversationId,
			viewer?.id ?? null,
			question,
			false
		);

		const [pillarRows, postRows, extras] = await Promise.all([
			lead.leadCampaignId
				? db
						.select({
							title: pillars.title,
							summary: pillars.summary,
							deliveryStatus: pillars.deliveryStatus,
							evidence: pillars.evidence
						})
						.from(pillars)
						.where(and(eq(pillars.campaignId, lead.leadCampaignId), isNull(pillars.deletedAt)))
				: Promise.resolve([]),
			db
				.select({ title: posts.title, body: posts.body })
				.from(posts)
				.where(
					and(
						eq(posts.subjectUserId, lead.subjectId),
						eq(posts.medium, 'web'),
						eq(posts.public, true),
						isNull(posts.deletedAt)
					)
				)
				.orderBy(desc(posts.createdAt))
				.limit(10),
			getGroundingExtras(lead.subjectId)
		]);
		const grounding = {
			name: lead.name,
			positionTitle: lead.positionTitle,
			regionLabel: lead.regionLabel,
			status: lead.status,
			bio: lead.bio,
			pillars: pillarRows,
			posts: postRows,
			...extras
		};

		let answer: string;
		let source: 'ai' | 'heuristic';
		try {
			({ answer, source } = await answerConstituentQuestion(grounding, question, toChatTurns(prior)));
		} catch (err) {
			if (err instanceof PlatformOutOfCreditsError) {
				// Platform-wide outage: the question is already captured, so hand it
				// to the team rather than showing a hard error to the citizen.
				await routeQuestionToTeam(questionMessageId);
				return { asked: true, answered: false, question };
			}
			throw err;
		}

		await recordAiAnswer(conversationId, answer);

		// Heuristic answers never call Anthropic, so nothing to charge for, and an
		// admin's ask is on the platform (it may not even have a wallet to bill).
		if (source === 'ai' && !platformAdmin && wallet) {
			const newBalance = wallet.balance - settings.aiChatCostCredits;
			await db.transaction(async (tx) => {
				await tx
					.update(wallets)
					.set({ balance: newBalance, updatedAt: new Date() })
					.where(eq(wallets.id, wallet.id));
				await tx.insert(creditTransactions).values({
					walletId: wallet.id,
					kind: 'spend',
					amount: -settings.aiChatCostCredits,
					channel: 'feature',
					reference: 'ai_chat',
					balanceAfter: newBalance
				});
			});
		}

		return { asked: true, answered: true, question, answer, answerSource: source };
	}
};
