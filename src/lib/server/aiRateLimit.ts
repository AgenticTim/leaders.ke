// Anti-abuse cap on the public AI Chat "ask" action (see [leader]/+page.server.ts
// and [leader]/[year]/+page.server.ts) — without this, a scripted burst of
// questions racks up real Anthropic API cost fast. Guests get a single free
// answer (lifetime, not daily — anonId/ipAddress are trivially resettable by
// clearing cookies, so the point isn't to meter guests precisely, it's to push
// them to log in after one taste); a signed-in citizen gets a real daily quota
// instead, tracked against their own account rather than a spoofable cookie.
// Both limits are admin-editable (platformSettings.guestAskLifetimeLimit /
// userAskDailyLimit — Settings → AI Chat), not hardcoded.
import { randomBytes } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { aiAskEvents } from '$lib/server/db/schema';
import { getPlatformSettings } from '$lib/server/settings';

const ANON_ID_COOKIE = 'anon_id'; // shared with /vote/2027's device cookie — one id per visitor across features

function startOfToday(): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

function anonDeviceId(): string {
	return randomBytes(16).toString('hex'); // matches /vote/2027's anonDeviceId — 32 hex chars
}

type RateLimitResult = { ok: true } | { ok: false; error: string; requiresLogin?: boolean };

/** Signed-in path: a real daily quota against the citizen's own domain user id
 * — can't be dodged by clearing cookies or switching devices the way the
 * guest path can. Records this attempt on success. */
async function enforceUserAskLimit(domainUserId: number, dailyLimit: number): Promise<RateLimitResult> {
	const [{ n }] = await db
		.select({ n: count() })
		.from(aiAskEvents)
		.where(and(gte(aiAskEvents.createdAt, startOfToday()), eq(aiAskEvents.userId, domainUserId)));
	if (n >= dailyLimit) {
		return { ok: false, error: `You've asked the maximum of ${dailyLimit} questions for today. Try again tomorrow.` };
	}
	await db.insert(aiAskEvents).values({ userId: domainUserId });
	return { ok: true };
}

/** Guest path: a free answer or two, lifetime (no time window — this isn't a
 * daily reset, it's a one-time taste before asking them to log in), checked
 * against both the anon_id cookie and the IP independently, same "either
 * dimension can trip it" shape the old daily limit used, so rotating one
 * alone doesn't help dodge the other. Mints the anon_id cookie if missing.
 * Records this attempt on success. */
async function enforceGuestAskLimit(event: RequestEvent, lifetimeLimit: number): Promise<RateLimitResult> {
	let anonId = event.cookies.get(ANON_ID_COOKIE) ?? null;
	if (!anonId) {
		anonId = anonDeviceId();
		event.cookies.set(ANON_ID_COOKIE, anonId, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
	}

	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}

	const [[{ n: byAnon }], [{ n: byIp }]] = await Promise.all([
		db.select({ n: count() }).from(aiAskEvents).where(eq(aiAskEvents.anonId, anonId)),
		ip ? db.select({ n: count() }).from(aiAskEvents).where(eq(aiAskEvents.ipAddress, ip)) : Promise.resolve([{ n: 0 }])
	]);

	if (byAnon >= lifetimeLimit || byIp >= lifetimeLimit) {
		return {
			ok: false,
			error: `You've used your free question${lifetimeLimit === 1 ? '' : 's'} as a guest. Log in to keep asking.`,
			requiresLogin: true
		};
	}

	await db.insert(aiAskEvents).values({ anonId, ipAddress: ip });
	return { ok: true };
}

/** domainUserId is the signed-in citizen's numeric users.id (null for a
 * guest) — the caller already resolves this via getDomainUser for the ask
 * action's own grounding lookup, so it's passed in rather than re-derived. */
export async function enforceAskRateLimit(event: RequestEvent, domainUserId: number | null): Promise<RateLimitResult> {
	const settings = await getPlatformSettings();
	return domainUserId
		? enforceUserAskLimit(domainUserId, settings.userAskDailyLimit)
		: enforceGuestAskLimit(event, settings.guestAskLifetimeLimit);
}
