import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { chargeMobileMoney, normalizeMpesaPhone, paystackEnabled } from '$lib/server/paystack';
import {
	contacts,
	creditTransactions,
	donations,
	managers,
	pillars,
	pledges,
	posts,
	wallets
} from '$lib/server/db/schema';
import {
	ACTIVE_CYCLE,
	fullName,
	getDomainUser,
	getOrCreateMainCampaign,
	leaderPath
} from '$lib/server/leader';
import { resolveCampaignRun, loadCampaignWorkspaceData } from '$lib/server/campaign';
import { enforceRateLimit, ipBucket } from '$lib/server/rateLimit';
import { followAsAccount, unfollowAsAccount } from '$lib/server/follow';
import { handleDeleteReviewAction, handleReviewAction } from '$lib/server/reviews';
import { answerConstituentQuestion, PlatformOutOfCreditsError } from '$lib/server/ai';
import { enforceAskRateLimit } from '$lib/server/aiRateLimit';
import { getGroundingExtras } from '$lib/server/knowledge';
import {
	getOrCreateWebConversation,
	recordAiAnswer,
	recordQuestion,
	routeQuestionToTeam
} from '$lib/server/chat';
import { getPlatformSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

/** A signed-in citizen's own phone (sms preferred, else whatsapp), formatted as
 * a local 07.../01.. number for prefilling the donate form's M-Pesa field. A
 * verified number wins over an unverified one. Messy/scraped contacts that
 * don't parse to a valid Kenyan mobile are skipped rather than prefilled. */
async function viewerPhone(userId: number): Promise<string | null> {
	const rows = await db
		.select({ value: contacts.value, channel: contacts.channel, verifiedAt: contacts.verifiedAt })
		.from(contacts)
		.where(
			and(
				eq(contacts.userId, userId),
				inArray(contacts.channel, ['sms', 'whatsapp']),
				isNull(contacts.deletedAt)
			)
		);
	const sorted = rows.sort((a, b) => {
		if (!!a.verifiedAt !== !!b.verifiedAt) return a.verifiedAt ? -1 : 1; // verified first
		return a.channel === 'sms' ? -1 : 1; // then sms over whatsapp
	});
	for (const r of sorted) {
		// normalizeMpesaPhone canonicalizes to +254XXXXXXXXX (or null if invalid);
		// swap the +254 back to a leading 0 for the familiar local display.
		const canonical = normalizeMpesaPhone(r.value);
		if (canonical) return `0${canonical.slice(4)}`;
	}
	return null;
}

// /[leader]/[year]: the active campaign workspace — manifesto with delivery
// tracker, updates, citizen reviews, vote pledges, fundraising and the AI
// constituent chat. Only the active cycle has a workspace; other years bounce
// to the permanent record. Public as soon as the run exists — verifiedAt is a
// "Verified" badge only (see docs/URLDiscovery.md), not a visibility gate.
export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	const recordPath = leaderPath({ slug: params.leader });
	if (Number(params.year) !== ACTIVE_CYCLE) redirect(302, recordPath);

	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;
	const row = await resolveCampaignRun(params.leader);
	if (!row) error(404, 'Campaign not found');

	// The viewer's existing pledge to this run (by account, or anon device cookie
	// for a guest), so a refresh keeps showing "Pledged ✓". Read-only here:
	// minting a fresh anon_id is the pledge action's job.
	const anonId = cookies.get('anon_id') ?? null;
	let isPledged = false;
	if (row.campaignId && (viewer || anonId)) {
		const [existingPledge] = await db
			.select({ id: pledges.id })
			.from(pledges)
			.where(
				and(
					eq(pledges.campaignId, row.campaignId),
					isNull(pledges.deletedAt),
					viewer ? eq(pledges.userId, viewer.id) : eq(pledges.anonId, anonId!)
				)
			)
			.limit(1);
		isPledged = !!existingPledge;
	}

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
					.where(
						and(
							eq(managers.userId, viewer.id),
							eq(managers.subjectUserId, row.users.id),
							eq(managers.isActive, true),
							isNull(managers.deletedAt)
						)
					)
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
			initials: name
				.split(/\s+/)
				.map((w) => w[0])
				.join('')
				.slice(0, 2)
				.toUpperCase(),
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
		campaignId: row.campaignId,
		isPledged,
		signedIn: !!locals.user,
		// Lets the Fund block prefill the donor name AND M-Pesa phone for a signed-in
		// citizen instead of asking them to retype either (prefer a verified phone).
		viewerProfile: viewer ? { name: fullName(viewer), phone: await viewerPhone(viewer.id) } : null,
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

	// Pledge a 2027 vote to this run. A pledge is a named promise, so it always
	// requires a logged-in account (guests get the auth modal client-side). The
	// campaign is resolved server-side, never trusted from the form.
	pledge: async (event) => {
		if (!event.locals.user) return fail(401, { pledgeError: 'Log in to pledge.' });
		const domainUser = await getDomainUser(event.locals.user.id);
		if (!domainUser) return fail(401, { pledgeError: 'Log in to pledge.' });

		const row = await resolveCampaignRun(event.params.leader);
		if (!row?.campaignId)
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
			.values({ userId: domainUser.id, campaignId: row.campaignId, ip, userAgent })
			.onConflictDoNothing();

		return { pledged: true };
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

		// Spam guard: open form that can fire an STK push, so cap per IP and per phone.
		const limit = await enforceRateLimit('donate', [
			ipBucket(event),
			phone ? `contact:${phone}` : ''
		]);
		if (!limit.ok)
			return fail(429, { error: 'Too many attempts. Please wait a minute and try again.' });

		// Donations attach to the run's main campaign. A verified run already has one;
		// a held officeholder's is created on first donation.
		let campaignId = row.campaignId;
		if (!campaignId && row.leaderId) {
			campaignId = (await getOrCreateMainCampaign(row.leaderId, row.users.id, fullName(row.users)))
				.id;
		}
		if (!campaignId) return fail(400, { error: 'Campaign not found.' });

		// With Paystack live and a valid M-Pesa number: fire a real STK push and
		// let the webhook confirm the pending row (donationFulfill.ts). Otherwise
		// (no key, or no/invalid phone) the row stays a manual pledge that the
		// campaign confirms against their till statement — the pre-STK behavior.
		const mpesaPhone = phone ? normalizeMpesaPhone(phone) : null;
		if (paystackEnabled() && mpesaPhone) {
			const reference = `don_${randomUUID()}`;
			await db.insert(donations).values({
				campaignId,
				donorName,
				phoneNumber: mpesaPhone,
				amount: Math.round(amount),
				reference
			});
			try {
				// Paystack requires an email per charge; donors don't give one, so a
				// synthetic per-phone address keeps their charges under one customer.
				await chargeMobileMoney({
					email: `donor-${mpesaPhone.replace('+', '')}@vote.ke`,
					amountKes: Math.round(amount),
					phone: mpesaPhone,
					reference
				});
			} catch (err) {
				// The prompt never reached the phone — no money moved, so the row
				// must not linger as a pending pledge the team might chase.
				await db
					.update(donations)
					.set({ status: 'failed', updatedAt: new Date() })
					.where(eq(donations.reference, reference));
				console.error(
					`[donate] STK charge failed for ${reference}:`,
					err instanceof Error ? err.message : err
				);
				return fail(502, { error: 'Could not reach M-Pesa right now. Try again in a moment.' });
			}
			return { donated: true, stk: true, amount: Math.round(amount) };
		}

		await db.insert(donations).values({
			campaignId,
			donorName,
			phoneNumber: phone || null,
			amount: Math.round(amount)
		});
		return { donated: true, stk: false, amount: Math.round(amount) };
	},

	ask: async (event) => {
		const form = await event.request.formData();
		const question = String(form.get('question') ?? '').trim();
		if (!question || question.length < 5) {
			return fail(400, { error: 'Ask a question of at least a few words.' });
		}

		const viewer = event.locals.user ? await getDomainUser(event.locals.user.id) : null;
		const rateLimit = await enforceAskRateLimit(event, viewer?.id ?? null);
		if (!rateLimit.ok)
			return fail(429, { error: rateLimit.error, requiresLogin: rateLimit.requiresLogin });

		const row = await resolveCampaignRun(event.params.leader);
		if (!row) return fail(404, { error: 'Campaign not found.' });

		// Every question is captured as a durable thread regardless of credit (the
		// team answers the uncredited ones from the dashboard Chats tab), so nothing
		// a citizen asks is ever lost.
		const conversationId = await getOrCreateWebConversation(row.users.id, viewer?.id ?? null);

		// Charged against the person's own wallet (docs/ai-chat-costs.md's PAYG
		// price, admin-editable as platformSettings.aiChatCostCredits), checked up
		// front. Profile-scoped (users.id), not campaignId: the knowledgebase a
		// wallet pays to query is one per person, not per run. With no credit the
		// question is still recorded and routed to the team — a human replies later
		// rather than the citizen hitting a dead end.
		const settings = await getPlatformSettings();
		const [wallet] = await db.select().from(wallets).where(eq(wallets.subjectUserId, row.users.id));
		if (!wallet || wallet.balance < settings.aiChatCostCredits) {
			await recordQuestion(conversationId, viewer?.id ?? null, question, true);
			return { asked: true, answered: false, question };
		}

		const questionMessageId = await recordQuestion(
			conversationId,
			viewer?.id ?? null,
			question,
			false
		);

		const [pillarRows, postRows, extras] = await Promise.all([
			db
				.select({
					title: pillars.title,
					summary: pillars.summary,
					deliveryStatus: pillars.deliveryStatus,
					evidence: pillars.evidence
				})
				.from(pillars)
				.where(and(eq(pillars.campaignId, row.campaignId), isNull(pillars.deletedAt))),
			db
				.select({ title: posts.title, body: posts.body })
				.from(posts)
				.where(
					and(
						eq(posts.subjectUserId, row.users.id),
						eq(posts.medium, 'web'),
						eq(posts.public, true),
						isNull(posts.deletedAt)
					)
				)
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
				// Platform-wide outage: the question is already captured, so hand it
				// to the team rather than showing a hard error to the citizen.
				await routeQuestionToTeam(questionMessageId);
				return { asked: true, answered: false, question };
			}
			throw err;
		}

		await recordAiAnswer(conversationId, answer);

		// Heuristic answers never call Anthropic, so nothing to charge for.
		if (source === 'ai') {
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
