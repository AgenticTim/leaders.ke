import { error } from '@sveltejs/kit';
import { requireLeader } from '$lib/server/dashboard';
import { redirectWithFlash } from '$lib/server/flash';
import { methodFromChannel, paystackEnabled, verifyTransaction } from '$lib/server/paystack';
import { fulfillUpgradePayment } from '$lib/server/subscriptionUpgrade';
import type { PageServerLoad } from './$types';

// Paystack sends the campaign admin back here after paying for a tier change.
// The reference is re-verified against Paystack's API (never trusted from the
// query), then fulfillment runs idempotently. If the webhook already applied
// the switch, this just redirects back to the upgrade page.
export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	if (!paystackEnabled()) error(404, 'Not found');

	const upgradeHref = `/dashboard/${ctx.profileUser.slug}/upgrade`;
	const reference =
		event.url.searchParams.get('reference') ?? event.url.searchParams.get('trxref') ?? '';
	if (!reference) error(400, 'Missing payment reference.');

	let verified;
	try {
		verified = await verifyTransaction(reference);
	} catch {
		redirectWithFlash(
			event.cookies,
			upgradeHref,
			'We could not confirm your payment yet. Your new plan activates as soon as the confirmation lands.'
		);
	}

	if (verified.status !== 'success') {
		redirectWithFlash(
			event.cookies,
			upgradeHref,
			'The payment was not completed. You can try again any time.'
		);
	}

	const result = await fulfillUpgradePayment(reference, {
		method: methodFromChannel(verified.channel),
		paidAt: verified.paidAt
	});
	if (!result.ok) {
		redirectWithFlash(event.cookies, upgradeHref, result.error);
	}
	redirectWithFlash(
		event.cookies,
		`/dashboard/${result.slug}/upgrade`,
		'Your plan has been upgraded. The new features are live.'
	);
};
