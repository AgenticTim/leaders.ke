import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { readFlash } from '$lib/server/flash';
import { env } from '$env/dynamic/private';
import { runSubscriptionSweep } from '$lib/server/subscriptionSweep';
import { ingestNews } from '$lib/server/newsIngest';
import { sendDailyDigests } from '$lib/server/digest';
import { sweepBroadcasts } from '$lib/server/broadcast';
import { getPlatformSettings } from '$lib/server/settings';

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

	// Broadcast dispatch recovery: a send runs inline on submit, so this only
	// mops up a broadcast left mid-flight by a crash/restart (queued recipients
	// remain). Idempotent, dispatch only touches queued rows, so a short cadence
	// is safe and keeps a stuck queue from sitting.
	const broadcastSweep = () => sweepBroadcasts().catch((err) => console.error('[broadcasts] sweep failed', err));
	setTimeout(broadcastSweep, 20_000);
	setInterval(broadcastSweep, 5 * 60 * 1000);

	// Daily news ingestion (Google News RSS per verified leader + whole-site
	// feeds). On by default in production; dev opts in with NEWS_INGEST=1 so
	// every reboot doesn't crawl. NEWS_INGEST=0 force-disables anywhere.
	// Scheduled by time-of-day (platformSettings.newsFetchTime, "HH:MM" local),
	// not "N hours since boot": a checker runs hourly and fires once the clock
	// passes that time AND newsLastFetchedAt isn't already today, so a mid-day
	// restart never triggers an extra off-schedule crawl. Hourly is coarse
	// enough that the actual fire time can drift up to ~59 minutes late, fine
	// for a once-a-day crawl.
	const ingestEnabled = env.NEWS_INGEST === '1' || (process.env.NODE_ENV === 'production' && env.NEWS_INGEST !== '0');
	if (ingestEnabled) {
		// The daily brief goes out on the back of the crawl, not on its own timer:
		// it reports what that crawl just found, so running them apart would email
		// yesterday's news. A digest failure must never look like an ingest failure,
		// hence its own catch.
		const run = () =>
			ingestNews()
				.then(async ({ people, inserted, failed, skipped }) => {
					if (skipped) return;
					console.log(`[news] ingested ${inserted} mentions across ${people} leaders (${failed} feeds failed)`);
					try {
						const { people: briefed, recipients } = await sendDailyDigests();
						if (briefed) console.log(`[digest] daily brief for ${briefed} leaders to ${recipients} recipients`);
					} catch (err) {
						console.error('[digest] daily brief failed', err);
					}
				})
				.catch((err) => console.error('[news] ingestion failed', err));

		const checkSchedule = async () => {
			const settings = await getPlatformSettings();
			const now = new Date();
			const nowHm = now.toTimeString().slice(0, 5); // "HH:MM" local
			const ranToday = settings.newsLastFetchedAt && new Date(settings.newsLastFetchedAt).toDateString() === now.toDateString();
			if (!ranToday && nowHm >= settings.newsFetchTime) run();
		};
		setTimeout(() => void checkSchedule(), 60_000); // one check shortly after boot, not a full hour's wait
		setInterval(() => void checkSchedule(), 60 * 60 * 1000);
	}
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
