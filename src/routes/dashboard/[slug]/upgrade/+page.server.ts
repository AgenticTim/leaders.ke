import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { payments, pricing, subscriptions } from '$lib/server/db/schema';
import { requireLeader, isCampaignAdmin } from '$lib/server/dashboard';
import { redirectWithFlash } from '$lib/server/flash';
import {
	BILLING_CYCLES,
	SUBSCRIPTION_TIERS,
	listCurrentPricing,
	listPackages,
	PERK_LABELS,
	PACKAGE_PERK_KEYS
} from '$lib/server/packages';
import { getPersonTier } from '$lib/server/invites';
import { getBalance } from '$lib/server/credits';
import { getPlatformSettings } from '$lib/server/settings';
import { initializeTransaction, paystackEnabled } from '$lib/server/paystack';
import {
	applyTierChange,
	computeProration,
	type UpgradeMetadata
} from '$lib/server/subscriptionUpgrade';
import type { Actions, PageServerLoad } from './$types';

// Tier-switching for an existing profile (TODO #19): the same rate card as
// /pricing and onboarding checkout, but it supersedes the current subscription
// instead of onboarding a new profile. Only a campaign admin (the billing
// decision-maker) may switch tiers.

/** The current active rate for a (tier, cycle), or null if none is set. */
async function currentRate(tier: string, cycle: string): Promise<number | null> {
	const [rate] = await db
		.select({ amount: pricing.amount })
		.from(pricing)
		.where(
			and(
				eq(pricing.tier, tier as 'kickstart'),
				eq(pricing.billingCycle, cycle as 'monthly'),
				isNull(pricing.activeTo)
			)
		);
	return rate?.amount ?? null;
}

export const load: PageServerLoad = async (event) => {
	const { domainUser, ctx } = await requireLeader(event);
	const canManageBilling = await isCampaignAdmin(domainUser.id, ctx);

	const [currentTier, [current], creditBalance, settings, pricingRows, packages] =
		await Promise.all([
			getPersonTier(ctx.profileUser.id),
			db
				.select({
					amount: subscriptions.amount,
					cycle: subscriptions.billingCycle,
					startAt: subscriptions.startAt,
					endsAt: subscriptions.endsAt
				})
				.from(subscriptions)
				.where(
					and(
						eq(subscriptions.subjectUserId, ctx.profileUser.id),
						eq(subscriptions.status, 'active')
					)
				)
				.orderBy(desc(subscriptions.startAt))
				.limit(1),
			getBalance(ctx.profileUser.id),
			getPlatformSettings(),
			listCurrentPricing(),
			listPackages()
		]);

	return {
		currentTier,
		credits: creditBalance,
		// The downgrade fee (percent) the client mirrors in its proration preview.
		downgradeFeePercent: settings.downgradeFeePercent,
		currentCycle: current?.cycle ?? null,
		// Fed to the client's proration preview (it recomputes the same numbers the
		// upgrade action applies authoritatively on submit).
		currentAmount: current?.amount ?? 0,
		currentStartAt: current?.startAt?.toISOString() ?? null,
		currentEndsAt: current?.endsAt?.toISOString() ?? null,
		canManageBilling,
		paystackLive: paystackEnabled(),
		pricing: pricingRows,
		packages,
		perkKeys: PACKAGE_PERK_KEYS,
		perkLabels: PERK_LABELS
	};
};

export const actions: Actions = {
	// Switch the profile's tier. Paystack (live key) charges on a hosted page and
	// fulfils via the callback/webhook (subscriptionUpgrade.ts); the mock dev
	// fallback applies the change instantly.
	upgrade: async (event) => {
		const { authUser, domainUser, ctx } = await requireLeader(event);
		if (!(await isCampaignAdmin(domainUser.id, ctx))) {
			return fail(403, { error: 'Only a campaign admin can change the plan.' });
		}

		const form = await event.request.formData();
		const tier = String(form.get('tier') ?? '');
		const cycle = String(form.get('cycle') ?? '');
		if (
			!(SUBSCRIPTION_TIERS as readonly string[]).includes(tier) ||
			!(BILLING_CYCLES as readonly string[]).includes(cycle)
		) {
			return fail(400, { error: 'Pick a valid plan.' });
		}

		const [currentTier, [currentSub]] = await Promise.all([
			getPersonTier(ctx.profileUser.id),
			db
				.select({
					amount: subscriptions.amount,
					cycle: subscriptions.billingCycle,
					startAt: subscriptions.startAt,
					endsAt: subscriptions.endsAt
				})
				.from(subscriptions)
				.where(
					and(
						eq(subscriptions.subjectUserId, ctx.profileUser.id),
						eq(subscriptions.status, 'active')
					)
				)
				.orderBy(desc(subscriptions.startAt))
				.limit(1)
		]);
		if (tier === currentTier && cycle === (currentSub?.cycle ?? cycle)) {
			return fail(400, { error: 'That is already your current plan.' });
		}

		const listPrice = await currentRate(tier, cycle);
		if (listPrice === null) return fail(400, { error: 'No price is set for that plan yet.' });

		// Credit the current plan's unused value against the new price; any excess
		// becomes wallet credits. A downgrade (strictly lower tier) takes the
		// admin-set fee (platformSettings.downgradeFeePercent) on those credits.
		// `chargeNow > 0` and `walletCredits > 0` are mutually exclusive, so a
		// switch the remainder fully covers needs no charge.
		const isDowngrade =
			SUBSCRIPTION_TIERS.indexOf(tier as 'kickstart') <
			SUBSCRIPTION_TIERS.indexOf(currentTier as 'kickstart');
		const { chargeNow, walletCredits } = computeProration({
			currentAmount: currentSub?.amount ?? 0,
			startAt: currentSub?.startAt ?? null,
			endsAt: currentSub?.endsAt ?? null,
			now: new Date(),
			newListPrice: listPrice,
			downgradeFeeRate: isDowngrade ? (await getPlatformSettings()).downgradeFeePercent / 100 : 0
		});

		// A real gateway can only charge a positive amount; a fully-credit-covered
		// switch (chargeNow === 0) applies directly even in production.
		if (paystackEnabled() && chargeNow > 0) {
			// Everything fulfillment needs rides on the pending payment row so the
			// webhook can finish without a session (subscriptionUpgrade.ts).
			const reference = `up_${randomUUID()}`;
			const metadata: UpgradeMetadata = {
				kind: 'upgrade',
				subjectUserId: ctx.profileUser.id,
				tier,
				cycle,
				chargeNow,
				walletCredits
			};
			await db.insert(payments).values({
				payerId: domainUser.id,
				campaignId: null,
				purpose: 'subscription',
				amount: chargeNow,
				status: 'pending',
				method: 'paystack',
				providerReference: reference,
				metadata
			});

			let authorizationUrl: string;
			try {
				({ authorizationUrl } = await initializeTransaction({
					email: authUser.email,
					amountKes: chargeNow,
					reference,
					callbackUrl: `${event.url.origin}/dashboard/${ctx.profileUser.slug}/upgrade/callback`
				}));
			} catch (err) {
				// Log the raw gateway reason (e.g. "Invalid key") for the operator; the
				// user gets an explicit, actionable message instead of that abstraction.
				console.error(
					`[upgrade] Paystack init failed for ${reference}:`,
					err instanceof Error ? err.message : err
				);
				await db
					.update(payments)
					.set({ status: 'failed' })
					.where(eq(payments.providerReference, reference));
				return fail(502, {
					error:
						'We couldn’t start the payment — the payment provider rejected the request. Card/M-Pesa billing is temporarily unavailable; please try again shortly or contact support.'
				});
			}
			redirect(303, authorizationUrl);
		}

		// Applied directly: the local mock path, or any switch fully covered by the
		// proration credit (chargeNow === 0) in any environment.
		const reference = `${paystackEnabled() ? 'credit' : 'mock'}-up-${randomUUID()}`;
		const result = await applyTierChange({
			subjectUserId: ctx.profileUser.id,
			payerId: domainUser.id,
			tier,
			cycle,
			chargeNow,
			walletCredits,
			method: paystackEnabled() ? 'credit' : 'mock',
			paidAt: new Date(),
			reference
		});
		// Only record a payment row when money actually changed hands.
		if (chargeNow > 0) {
			await db.insert(payments).values({
				payerId: domainUser.id,
				purpose: 'subscription',
				subscriptionId: result.subscriptionId,
				amount: chargeNow,
				status: 'success',
				method: 'mock',
				providerReference: reference,
				metadata: { mock: true, kind: 'upgrade' },
				paidAt: new Date()
			});
		}

		const tierLabel = `${tier[0].toUpperCase()}${tier.slice(1)}`;
		const creditNote =
			walletCredits > 0
				? ` ${walletCredits.toLocaleString('en-KE')} credits were added to your wallet (unused value less the downgrade fee).`
				: '';
		redirectWithFlash(
			event.cookies,
			`/dashboard/${result.slug}/upgrade`,
			`You're now on the ${tierLabel} plan.${creditNote}`
		);
	}
};
