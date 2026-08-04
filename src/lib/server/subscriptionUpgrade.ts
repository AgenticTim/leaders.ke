// Tier switching for an EXISTING profile (TODO #19), the counterpart of
// checkoutFulfill.ts (which is for first-time onboarding). No profile is
// created here. The person already has one; we supersede their current
// subscription with a new one at the chosen tier.
//
// Mid-term proration (1 credit = KES 1, see docs/ai-costs.md): the unused value
// of the current plan is credited against the new plan's price. The customer
// pays only the difference, and any excess (remainder > new price) spills into
// their credit wallet. Because `applied = min(remainder, newPrice)`, exactly one
// of {chargeNow, excessCredits} is ever non-zero: a switch fully covered by the
// remainder needs no gateway charge at all.
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { creditTransactions, payments, subscriptions, users, wallets } from '$lib/server/db/schema';
import { SUBSCRIPTION_TIERS } from '$lib/server/packages';
import { notifyPayerOfPayment } from '$lib/server/onboard';

// A downgrade converts leftover plan value into wallet credits; a fee is taken
// on that conversion (it's a cash-out of prepaid subscription value, not a
// like-for-like swap). The rate is admin-set (platformSettings.downgradeFeePercent,
// default 5%) and passed in as `downgradeFeeRate`. Upgrades never produce
// leftover credits, so the fee only ever bites on downgrades.

export type Proration = {
	remainder: number; // unused KES value of the current plan
	applied: number; // remainder used to discount the new plan's price
	chargeNow: number; // KES still owed after the credit (new price - applied)
	excessGross: number; // leftover remainder before the downgrade fee
	fee: number; // downgrade fee withheld from the leftover
	walletCredits: number; // net credited to the wallet (excessGross - fee)
};

/** Time-proration of the current plan's unused value, split into a discount on
 * the new price vs. leftover credits (net of the downgrade fee). Pure (no DB)
 * so the page previews the exact numbers the server will apply. Pass
 * `downgradeFeeRate` > 0 only when the switch is a tier downgrade. */
export function computeProration(input: {
	currentAmount: number; // KES paid for the current active sub (0 if none)
	startAt: Date | null;
	endsAt: Date | null;
	now: Date;
	newListPrice: number; // KES list price of the target plan
	downgradeFeeRate?: number; // 0 unless this is a downgrade
}): Proration {
	const { currentAmount, startAt, endsAt, now, newListPrice, downgradeFeeRate = 0 } = input;
	let remainder = 0;
	if (startAt && endsAt && endsAt > now && endsAt > startAt && currentAmount > 0) {
		const total = endsAt.getTime() - startAt.getTime();
		const left = endsAt.getTime() - now.getTime();
		remainder = Math.max(0, Math.min(Math.round(currentAmount * (left / total)), currentAmount));
	}
	const applied = Math.min(remainder, newListPrice);
	const excessGross = remainder - applied;
	const fee = Math.round(excessGross * downgradeFeeRate);
	return {
		remainder,
		applied,
		chargeNow: newListPrice - applied,
		excessGross,
		fee,
		walletCredits: excessGross - fee
	};
}

export type UpgradeMetadata = {
	kind: 'upgrade';
	subjectUserId: number;
	tier: string;
	cycle: string;
	chargeNow: number; // what the gateway charges (recorded as the subscription amount)
	walletCredits: number; // net credited to the wallet on fulfillment (0 on a charged switch)
	/** Set after fulfillment so a repeat callback can still redirect cleanly. */
	slug?: string;
};

/** upgrade vs downgrade is purely for the audit `origin`, both switch the tier
 * the same way; the label is which direction along the tier order we moved. */
function originFor(fromTier: string, toTier: string): 'upgrade' | 'downgrade' {
	return SUBSCRIPTION_TIERS.indexOf(toTier as 'kickstart') >=
		SUBSCRIPTION_TIERS.indexOf(fromTier as 'kickstart')
		? 'upgrade'
		: 'downgrade';
}

/** Supersedes the person's current active subscription with a fresh one at the
 * chosen tier, recording `chargeNow` as the (proration-net) amount and granting
 * `walletCredits` (already net of any downgrade fee) to the wallet. All atomic.
 * Returns the slug for the redirect. */
export async function applyTierChange(opts: {
	subjectUserId: number;
	payerId: number;
	tier: string;
	cycle: string;
	chargeNow: number;
	walletCredits: number;
	method: string;
	paidAt: Date;
	reference: string;
}): Promise<{ slug: string; subscriptionId: number }> {
	const {
		subjectUserId,
		payerId,
		tier,
		cycle,
		chargeNow,
		walletCredits,
		method,
		paidAt,
		reference
	} = opts;

	const [current] = await db
		.select({ id: subscriptions.id, tier: subscriptions.tier })
		.from(subscriptions)
		.where(and(eq(subscriptions.subjectUserId, subjectUserId), eq(subscriptions.status, 'active')))
		.orderBy(desc(subscriptions.startAt))
		.limit(1);

	const endsAt = new Date(paidAt);
	if (cycle === 'annual') endsAt.setFullYear(endsAt.getFullYear() + 1);
	else endsAt.setMonth(endsAt.getMonth() + 1);

	const subscriptionId = await db.transaction(async (tx) => {
		// Cancel every currently-active sub (there should be one, but guard drift)
		// so getPersonTier's "latest active" resolves to the new row unambiguously.
		await tx
			.update(subscriptions)
			.set({ status: 'cancelled', cancelledAt: paidAt, updatedAt: paidAt })
			.where(
				and(eq(subscriptions.subjectUserId, subjectUserId), eq(subscriptions.status, 'active'))
			);

		const [created] = await tx
			.insert(subscriptions)
			.values({
				subjectUserId,
				payerId,
				tier: tier as 'kickstart',
				billingCycle: cycle as 'monthly',
				amount: chargeNow, // net of the proration credit (see schema comment)
				status: 'active',
				origin: current ? originFor(current.tier, tier) : 'upgrade',
				previousSubscriptionId: current?.id ?? null,
				startAt: paidAt,
				endsAt,
				paidAt,
				paymentMethod: method,
				paymentReference: reference
			})
			.returning({ id: subscriptions.id });

		// Leftover value from the old plan becomes wallet credits (1 credit = KES 1),
		// already net of the downgrade fee.
		if (walletCredits > 0) {
			const [w] = await tx
				.insert(wallets)
				.values({ subjectUserId, balance: walletCredits })
				.onConflictDoUpdate({
					target: wallets.subjectUserId,
					set: { balance: sql`${wallets.balance} + ${walletCredits}`, updatedAt: paidAt }
				})
				.returning({ id: wallets.id, balance: wallets.balance });
			await tx.insert(creditTransactions).values({
				walletId: w.id,
				kind: 'bonus',
				amount: walletCredits,
				channel: 'plan_change',
				reference,
				balanceAfter: w.balance
			});
		}
		return created.id;
	});

	// An upgradeable profile always has a slug (it went through onboarding).
	const [subject] = await db
		.select({ slug: users.slug })
		.from(users)
		.where(eq(users.id, subjectUserId));
	const slug = subject?.slug ?? '';

	await notifyPayerOfPayment({
		payerUserId: payerId,
		subjectUserId,
		slug,
		tier,
		cycle,
		amount: chargeNow,
		subscriptionEndsAt: endsAt,
		reference,
		method
	});

	return { slug, subscriptionId };
}

/** Paystack fulfillment for a tier change: claims the pending `up_` payment
 * (status-guarded so callback + webhook can't double-apply), then switches the
 * tier. Mirrors fulfillSubscriptionPayment's idempotency. */
export async function fulfillUpgradePayment(
	reference: string,
	verified: { method: string; paidAt: Date | null }
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
	const paidAt = verified.paidAt ?? new Date();

	const [payment] = await db
		.update(payments)
		.set({ status: 'success', method: verified.method, paidAt })
		.where(and(eq(payments.providerReference, reference), eq(payments.status, 'pending')))
		.returning();

	if (!payment) {
		const [existing] = await db
			.select()
			.from(payments)
			.where(eq(payments.providerReference, reference));
		if (!existing) return { ok: false, error: 'Unknown payment reference.' };
		const meta = (existing.metadata ?? {}) as UpgradeMetadata;
		if (existing.status === 'success' && meta.slug) return { ok: true, slug: meta.slug };
		return { ok: false, error: 'This upgrade could not be completed.' };
	}

	const meta = (payment.metadata ?? {}) as UpgradeMetadata;
	const result = await applyTierChange({
		subjectUserId: meta.subjectUserId,
		payerId: payment.payerId,
		tier: meta.tier,
		cycle: meta.cycle,
		chargeNow: meta.chargeNow,
		walletCredits: meta.walletCredits,
		method: verified.method,
		paidAt,
		reference
	});

	await db
		.update(payments)
		.set({ subscriptionId: result.subscriptionId, metadata: { ...meta, slug: result.slug } })
		.where(eq(payments.id, payment.id));

	return { ok: true, slug: result.slug };
}

/** Whether a Paystack reference is a tier-change charge (vs `ps_` onboarding
 * checkout or `don_` donations), how the shared webhook routes an event. */
export function isUpgradeReference(reference: string): boolean {
	return reference.startsWith('up_');
}
