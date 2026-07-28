import { error, fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { creditTransactions, donations, managers, pillars, posts, wallets } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, getDomainUser, getOrCreateMainCampaign, leaderPath } from '$lib/server/leader';
import { resolveCampaignRun, loadCampaignWorkspaceData } from '$lib/server/campaign';
import { followAsAccount, unfollowAsAccount } from '$lib/server/follow';
import { handleDeleteReviewAction, handleReviewAction } from '$lib/server/reviews';
import { answerConstituentQuestion, PlatformOutOfCreditsError } from '$lib/server/ai';
import { enforceAskRateLimit } from '$lib/server/aiRateLimit';
import { getGroundingExtras } from '$lib/server/knowledge';
import { getPlatformSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

// /[leader]/[year]: the active campaign workspace — manifesto with delivery
// tracker, updates, citizen reviews, vote pledges, fundraising and the AI
// constituent chat. Only the active cycle has a workspace; other years bounce
// to the permanent record. Public as soon as the run exists — verifiedAt is a
// "Verified" badge only (see docs/URLDiscovery.md), not a visibility gate.
export const load: PageServerLoad = async ({ params, locals }) => {
	const recordPath = leaderPath({ slug: params.leader });
	if (Number(params.year) !== ACTIVE_CYCLE) redirect(302, recordPath);

	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;
	const row = await resolveCampaignRun(params.leader);
	if (!row) error(404, 'Campaign not found');

	const workspace = await loadCampaignWorkspaceData(row, viewer?.id);
	const name = fullName(row.users);

	// Same "who may manage this profile" check as the public profile page's
	// canEdit: a platform admin, or an active manager on the run's team (the
	// person themselves included — they're their own first manager).
	const viewerIsManager = viewer
		? viewer.id === row.users.id ||
			!!(
				await db
					.select({ id: managers.id })
					.from(managers)
					.where(and(eq(managers.userId, viewer.id), eq(managers.subjectUserId, row.users.id), eq(managers.isActive, true), isNull(managers.deletedAt)))
			)[0]
		: false;
	const canEdit = !!viewer?.adminAt || viewerIsManager;

	return {
		year: Number(params.year),
		recordPath,
		currentPosition: row.currentPosition,
		canEdit,
		leaderSlug: params.leader,
		leader: {
			name,
			initials: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
			photoUrl: row.users.photoUrl,
			party: workspace.party,
			regionLabel: row.positions.region,
			positionTitle: row.positions.title,
			status: row.status,
			verified: row.verified,
			followers: workspace.followers,
			// The run's own pitch (Campaign tab), not the person's general profile bio —
			// this workspace is about the 2027 campaign specifically.
			campaignTitle: workspace.title,
			campaignDescription: workspace.description,
			pillars: workspace.pillars
		},
		posts: workspace.posts,
		reviews: workspace.reviews,
		reviewPillarOptions: workspace.reviewPillarOptions,
		flaggedReviewCounts: workspace.flaggedReviewCounts,
		myReview: workspace.myReview,
		isFollowing: workspace.isFollowing,
		signedIn: !!locals.user,
		// Lets the Fund block prefill the donor name for a signed-in citizen instead
		// of asking them to retype it.
		viewerProfile: viewer ? { name: fullName(viewer) } : null,
		pledgeCount: workspace.pledgeCount,
		fundraising: workspace.fundraising
	};
};

export const actions: Actions = {
	// Signed-in only — the account itself is the proof, no name/contact capture
	// or OTP confirm needed (see followAsAccount).
	follow: async (event) => {
		if (!event.locals.user) return fail(401, { error: 'Log in to follow.' });
		const domainUser = await getDomainUser(event.locals.user.id);
		if (!domainUser) return fail(401, { error: 'Log in to follow.' });

		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(400, { error: 'Campaign not found.' });

		const result = await followAsAccount(domainUser.id, row.users.id);
		if (!result.ok) return fail(400, { error: result.error });
		return { followed: true };
	},

	unfollow: async (event) => {
		if (!event.locals.user) return fail(401, { error: 'Log in first.' });
		const domainUser = await getDomainUser(event.locals.user.id);
		if (!domainUser) return fail(401, { error: 'Log in first.' });

		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(400, { error: 'Campaign not found.' });

		await unfollowAsAccount(domainUser.id, row.users.id);
		return { unfollowed: true };
	},

	review: async (event) => {
		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(400, { reviewError: 'Campaign not found.' });
		return await handleReviewAction(event, row.users.id, row.campaignId);
	},

	deleteReview: async (event) => {
		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(400, { reviewError: 'Campaign not found.' });
		return await handleDeleteReviewAction(event, row.users.id);
	},

	donate: async (event) => {
		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(400, { error: 'Campaign not found.' });

		const form = await event.request.formData();
		const donorName = String(form.get('donorName') ?? '').trim();
		const phone = String(form.get('phone') ?? '').replace(/[^\d+]/g, '');
		const amount = Number(form.get('amount') ?? 0);
		if (!donorName || !Number.isFinite(amount) || amount < 10) {
			return fail(400, { error: 'Your name and an amount (KES 10 or more) are required.' });
		}

		// Donations attach to the run's main campaign. A verified run already has one;
		// a held officeholder's is created on first donation.
		let campaignId = row.campaignId;
		if (!campaignId && row.leaderId) {
			campaignId = (await getOrCreateMainCampaign(row.leaderId, row.users.id, fullName(row.users))).id;
		}
		if (!campaignId) return fail(400, { error: 'Campaign not found.' });
		await db.insert(donations).values({
			campaignId,
			donorName,
			phoneNumber: phone || null,
			amount: Math.round(amount)
		});
		// The campaign confirms receipt against their M-Pesa statement (STK push automates this later).
		return { donated: true, amount: Math.round(amount) };
	},

	ask: async (event) => {
		const form = await event.request.formData();
		const question = String(form.get('question') ?? '').trim();
		if (!question || question.length < 5) {
			return fail(400, { error: 'Ask a question of at least a few words.' });
		}

		const viewer = event.locals.user ? await getDomainUser(event.locals.user.id) : null;
		const rateLimit = await enforceAskRateLimit(event, viewer?.id ?? null);
		if (!rateLimit.ok) return fail(429, { error: rateLimit.error, requiresLogin: rateLimit.requiresLogin });

		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(404, { error: 'Campaign not found.' });

		// Charged against the person's own wallet (docs/ai-chat-costs.md's PAYG
		// price, admin-editable as platformSettings.aiChatCostCredits), checked up
		// front so a citizen gets a clear reason instead of a silent failure — the
		// heuristic fallback never runs here on empty credits, since answering
		// for free would just mask the gate entirely. Profile-scoped (users.id),
		// not campaignId: the knowledgebase a wallet pays to query is one per
		// person, not per run.
		const settings = await getPlatformSettings();
		const [wallet] = await db.select().from(wallets).where(eq(wallets.subjectUserId, row.users.id));
		if (!wallet || wallet.balance < settings.aiChatCostCredits) {
			return fail(402, { error: 'This profile has no AI Chat credits left. The team needs to top up before more questions can be answered.' });
		}

		const [pillarRows, postRows, extras] = await Promise.all([
			db
				.select({ title: pillars.title, summary: pillars.summary, deliveryStatus: pillars.deliveryStatus, evidence: pillars.evidence })
				.from(pillars)
				.where(and(eq(pillars.campaignId, row.campaignId), isNull(pillars.deletedAt))),
			db
				.select({ title: posts.title, body: posts.body })
				.from(posts)
				.where(and(eq(posts.subjectUserId, row.users.id), eq(posts.medium, 'web'), eq(posts.public, true), isNull(posts.deletedAt)))
				.orderBy(desc(posts.createdAt))
				.limit(10),
			getGroundingExtras(row.users.id)
		]);
		const grounding = {
			name: fullName(row.users),
			positionTitle: row.positions.title,
			regionLabel: row.positions.region,
			status: row.status,
			bio: row.users.bio ?? '',
			pillars: pillarRows,
			posts: postRows,
			...extras
		};

		let answer: string;
		let source: 'ai' | 'heuristic';
		try {
			({ answer, source } = await answerConstituentQuestion(grounding, question));
		} catch (err) {
			if (err instanceof PlatformOutOfCreditsError) {
				return fail(503, { error: 'AI Chat is temporarily unavailable (the platform is out of AI credits). Please try again later.' });
			}
			throw err;
		}

		// Heuristic answers never call Anthropic, so nothing to charge for.
		if (source === 'ai') {
			const newBalance = wallet.balance - settings.aiChatCostCredits;
			await db.transaction(async (tx) => {
				await tx.update(wallets).set({ balance: newBalance, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
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

		return { asked: true, question, answer, answerSource: source };
	}
};
