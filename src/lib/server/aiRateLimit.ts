// Anti-abuse cap on the public AI Chat "ask" action (see [leader]/+page.server.ts
// and [leader]/[year]/+page.server.ts) — without this, a scripted burst of
// questions racks up real Anthropic API cost fast. Guests get a few free AI
// answers (lifetime, not daily — anonId/ipAddress are trivially resettable by
// clearing cookies, so the point isn't to meter guests precisely); once
// exhausted their questions still go through, routed to the team instead of
// the AI (`teamOnly`) — never a dead end, just no more API spend — behind a
// sliding-window flood cap (rateLimit.ts 'ask'). A signed-in citizen gets a
// real daily quota instead, tracked against their own account rather than a
// spoofable cookie. Both limits are admin-editable
// (platformSettings.guestAskLifetimeLimit / userAskDailyLimit — Settings → AI
// Chat), not hardcoded.
import { and, count, eq, gte } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getOrMintAnonId } from '$lib/server/anonId';
import { db } from '$lib/server/db';
import { aiAskEvents } from '$lib/server/db/schema';
import { enforceRateLimit, ipBucket } from '$lib/server/rateLimit';
import { getPlatformSettings } from '$lib/server/settings';

function startOfToday(): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

// `teamOnly` = the question may proceed but must skip the AI and go straight
// to the team (guest free answers exhausted).
type RateLimitResult = { ok: true; teamOnly?: boolean } | { ok: false; error: string };

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

/** Guest path: a free AI answer or two, lifetime (no time window), checked
 * against both the anon_id cookie and the IP independently, same "either
 * dimension can trip it" shape the old daily limit used, so rotating one
 * alone doesn't help dodge the other. Mints the anon_id cookie if missing.
 * Records this attempt on success. Once the free answers are spent, questions
 * still go through as `teamOnly` (recorded + routed to the team, no AI call)
 * behind the 'ask' flood window — a guest is never told to stop asking. */
async function enforceGuestAskLimit(event: RequestEvent, lifetimeLimit: number): Promise<RateLimitResult> {
	const anonId = getOrMintAnonId(event.cookies);

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
		const flood = await enforceRateLimit('ask', [`anon:${anonId}`, ipBucket(event)]);
		if (!flood.ok) {
			return { ok: false, error: 'Too many questions in a short time — please try again in a minute.' };
		}
		return { ok: true, teamOnly: true };
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
