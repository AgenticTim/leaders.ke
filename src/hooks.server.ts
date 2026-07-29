import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { readFlash } from '$lib/server/flash';
import { runSubscriptionSweep } from '$lib/server/subscriptionSweep';

// Subscription lifecycle timer: renewal reminders + expiry, swept shortly after
// boot and every 6 hours for as long as the server process lives. In-process on
// purpose (no external cron to configure on the VPS); the sweep itself is
// idempotent, so an overlap after a restart costs nothing.
if (!building) {
	const sweep = () =>
		runSubscriptionSweep()
			.then(({ reminded, expired }) => {
				if (reminded || expired) console.log(`[subscriptions] sweep: ${reminded} reminded, ${expired} expired`);
			})
			.catch((err) => console.error('[subscriptions] sweep failed', err));
	setTimeout(sweep, 15_000);
	setInterval(sweep, 6 * 60 * 60 * 1000);
}

// One-shot notice banner (see $lib/server/flash.ts): read the cookie into
// locals.flash and consume it. login/signup only peek, so the banner survives
// switching between the two forms; their actions clear it on success.
const handleFlash: Handle = async ({ event, resolve }) => {
	const peek = event.url.pathname === '/login' || event.url.pathname === '/signup';
	event.locals.flash = readFlash(event.cookies, { peek });
	return resolve(event);
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handleFlash, handleBetterAuth);
