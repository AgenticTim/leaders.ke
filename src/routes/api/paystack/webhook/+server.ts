import { json } from '@sveltejs/kit';
import { fulfillSubscriptionPayment } from '$lib/server/checkoutFulfill';
import { confirmDonation, failDonation, isDonationReference } from '$lib/server/donationFulfill';
import { fulfillUpgradePayment, isUpgradeReference } from '$lib/server/subscriptionUpgrade';
import { methodFromChannel, verifyWebhookSignature } from '$lib/server/paystack';
import type { RequestHandler } from './$types';

// Paystack webhook: the reliable fulfillment path (the callback page only runs
// if the customer's browser makes it back, and STK-push donations have no
// callback page at all). Authenticity comes from the HMAC-SHA512 signature
// over the raw body; fulfillment itself is idempotent, so callback + webhook
// double-delivery is harmless. The reference prefix routes the event:
// `don_` = donation STK charge, `up_` = tier change, `ps_` = onboarding checkout.
export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	if (!verifyWebhookSignature(rawBody, request.headers.get('x-paystack-signature'))) {
		return json({ ok: false }, { status: 401 });
	}

	const event = JSON.parse(rawBody) as {
		event: string;
		data?: { reference?: string; channel?: string; paid_at?: string };
	};
	const reference = event.data?.reference;

	if (event.event === 'charge.success' && reference) {
		const verified = {
			method: methodFromChannel(event.data?.channel ?? null),
			paidAt: event.data?.paid_at ? new Date(event.data.paid_at) : null
		};
		if (isDonationReference(reference)) {
			await confirmDonation(reference);
		} else if (isUpgradeReference(reference)) {
			await fulfillUpgradePayment(reference, verified);
		} else {
			await fulfillSubscriptionPayment(reference, verified);
		}
	} else if (event.event === 'charge.failed' && reference && isDonationReference(reference)) {
		// Declined/timed-out STK prompt — surface it as failed on the ledger.
		await failDonation(reference);
	}

	// Non-charge events are acknowledged so Paystack stops retrying them.
	return json({ ok: true });
};
