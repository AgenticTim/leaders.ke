import { json } from '@sveltejs/kit';
import { fulfillSubscriptionPayment } from '$lib/server/checkoutFulfill';
import { methodFromChannel, verifyWebhookSignature } from '$lib/server/paystack';
import type { RequestHandler } from './$types';

// Paystack webhook: the reliable fulfillment path (the callback page only runs
// if the customer's browser makes it back). Authenticity comes from the
// HMAC-SHA512 signature over the raw body; fulfillment itself is idempotent,
// so callback + webhook double-delivery is harmless.
export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	if (!verifyWebhookSignature(rawBody, request.headers.get('x-paystack-signature'))) {
		return json({ ok: false }, { status: 401 });
	}

	const event = JSON.parse(rawBody) as {
		event: string;
		data?: { reference?: string; channel?: string; paid_at?: string };
	};

	if (event.event === 'charge.success' && event.data?.reference) {
		await fulfillSubscriptionPayment(event.data.reference, {
			method: methodFromChannel(event.data.channel ?? null),
			paidAt: event.data.paid_at ? new Date(event.data.paid_at) : null
		});
	}

	// Non-charge events are acknowledged so Paystack stops retrying them.
	return json({ ok: true });
};
