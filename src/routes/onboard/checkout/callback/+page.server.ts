import { error } from '@sveltejs/kit';
import { requireDashboardUser } from '$lib/server/dashboard';
import { redirectWithFlash } from '$lib/server/flash';
import { fulfillSubscriptionPayment } from '$lib/server/checkoutFulfill';
import { methodFromChannel, paystackEnabled, verifyTransaction } from '$lib/server/paystack';
import type { PageServerLoad } from './$types';

// Paystack sends the customer back here after the hosted payment page. The
// reference is re-verified against Paystack's API (never trusted from the
// query), then fulfillment runs idempotently. If the webhook already
// fulfilled it, this just redirects to the dashboard.
export const load: PageServerLoad = async (event) => {
	await requireDashboardUser(event);
	if (!paystackEnabled()) error(404, 'Not found');

	const reference = event.url.searchParams.get('reference') ?? event.url.searchParams.get('trxref') ?? '';
	if (!reference) error(400, 'Missing payment reference.');

	let verified;
	try {
		verified = await verifyTransaction(reference);
	} catch {
		redirectWithFlash(event.cookies, '/onboard/profile', 'We could not confirm your payment yet. If you were charged, your dashboard unlocks as soon as the confirmation lands.');
	}

	if (verified.status !== 'success') {
		redirectWithFlash(event.cookies, '/onboard/profile', 'The payment was not completed. You can try again any time.');
	}

	const result = await fulfillSubscriptionPayment(reference, {
		method: methodFromChannel(verified.channel),
		paidAt: verified.paidAt
	});
	if (!result.ok) {
		redirectWithFlash(event.cookies, '/dashboard', result.error);
	}
	redirectWithFlash(event.cookies, `/dashboard/${result.slug}/profile`, "Your payment was successful! Welcome to your leader's dashboard.");
};
