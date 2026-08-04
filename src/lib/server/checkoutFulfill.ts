// Post-payment fulfillment for subscription checkout, shared by the Paystack
// callback page and the webhook so whichever arrives first wins and the other
// becomes a no-op. The pending `payments` row (written at initialize time)
// carries everything needed in metadata; claiming it with a status-guarded
// UPDATE is what makes fulfillment idempotent, only the claimer proceeds to
// create the profile and subscription.
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { payments, subscriptions } from '$lib/server/db/schema';
import { createProfile, linkProfile, notifyAdminsOfNewProfile, notifyPayerOfPayment } from '$lib/server/onboard';
import type { OnboardInput } from '$lib/server/onboard';

export type CheckoutMetadata = {
	tier: string;
	cycle: string;
	amount: number;
	input: OnboardInput;
	linkSubjectId: number | null;
	/** Set after fulfillment so a repeat callback can still redirect to the dashboard. */
	slug?: string;
	fulfillError?: string;
};

export async function fulfillSubscriptionPayment(
	reference: string,
	verified: { method: string; paidAt: Date | null }
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
	const paidAt = verified.paidAt ?? new Date();

	// Claim the pending row; exactly one of callback/webhook wins this UPDATE.
	const [payment] = await db
		.update(payments)
		.set({ status: 'success', method: verified.method, paidAt })
		.where(and(eq(payments.providerReference, reference), eq(payments.status, 'pending')))
		.returning();

	if (!payment) {
		// Already fulfilled (or unknown): report the stored slug so the callback
		// can still land the customer on their dashboard.
		const [existing] = await db.select().from(payments).where(eq(payments.providerReference, reference));
		if (!existing) return { ok: false, error: 'Unknown payment reference.' };
		const meta = (existing.metadata ?? {}) as CheckoutMetadata;
		if (existing.status === 'success' && meta.slug) return { ok: true, slug: meta.slug };
		return { ok: false, error: meta.fulfillError ?? 'This payment could not be completed.' };
	}

	const meta = (payment.metadata ?? {}) as CheckoutMetadata;

	// The money is captured at this point, so a fulfillment failure must never
	// look like a failed charge: record the error on the payment for admin
	// follow-up instead of rolling the status back.
	try {
		const result = meta.linkSubjectId
			? await linkProfile(payment.payerId, meta.input, meta.linkSubjectId)
			: await createProfile(payment.payerId, meta.input);

		const endsAt = new Date(paidAt);
		if (meta.cycle === 'annual') endsAt.setFullYear(endsAt.getFullYear() + 1);
		else endsAt.setMonth(endsAt.getMonth() + 1);

		const [subscription] = await db
			.insert(subscriptions)
			.values({
				subjectUserId: result.subjectUserId,
				payerId: payment.payerId,
				tier: meta.tier as 'kickstart',
				billingCycle: meta.cycle as 'monthly',
				amount: meta.amount,
				status: 'active',
				origin: 'new',
				startAt: paidAt,
				endsAt,
				paidAt,
				paymentMethod: verified.method,
				paymentReference: reference
			})
			.returning();

		await db
			.update(payments)
			.set({ subscriptionId: subscription.id, metadata: { ...meta, slug: result.slug } })
			.where(eq(payments.id, payment.id));

		await notifyAdminsOfNewProfile({
			kind: meta.linkSubjectId ? 'claimed' : 'created',
			actorUserId: payment.payerId,
			subjectUserId: result.subjectUserId,
			slug: result.slug,
			tier: meta.tier,
			cycle: meta.cycle,
			amount: meta.amount,
			subscriptionEndsAt: endsAt
		});
		await notifyPayerOfPayment({
			payerUserId: payment.payerId,
			subjectUserId: result.subjectUserId,
			slug: result.slug,
			tier: meta.tier,
			cycle: meta.cycle,
			amount: meta.amount,
			subscriptionEndsAt: endsAt,
			reference,
			method: verified.method
		});

		return { ok: true, slug: result.slug };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Fulfillment failed.';
		await db
			.update(payments)
			.set({ metadata: { ...meta, fulfillError: message } })
			.where(eq(payments.id, payment.id));
		console.error(`[checkout] paid but unfulfilled: ${reference}, ${message}`);
		return { ok: false, error: `Your payment was received, but setting up the profile hit a snag (${message}). Our team has been alerted.` };
	}
}
