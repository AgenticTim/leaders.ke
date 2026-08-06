// Anti-abuse cap on the public AI Chat "ask" action (see [leader]/+page.server.ts
// and [leader]/[year]/+page.server.ts), without this, a scripted burst of
// questions racks up real Anthropic API cost fast. Guests get a few free AI
// answers (lifetime, not daily, anonId/ipAddress are trivially resettable by
// clearing cookies, so the point isn't to meter guests precisely); once
// exhausted their questions still go through, routed to the team instead of
// the AI (`teamOnly`), never a dead end, just no more API spend, behind a
// sliding-window flood cap (rateLimit.ts 'ask'). A signed-in citizen gets a
// real daily quota instead, tracked against their own account rather than a
// spoofable cookie. Both limits are admin-editable
// (platformSettings.guestAskLifetimeLimit / userAskDailyLimit, Settings → AI
// Chat), not hardcoded. Platform admins are exempt from both, and the
// `platformAdmin` flag on the result carries that exemption to the caller's own
// gates (the profile wallet check).
import { and, count, eq, gte, isNotNull } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getOrMintAnonId } from '$lib/server/anonId';
import { db } from '$lib/server/db';
import { aiAskEvents, users } from '$lib/server/db/schema';
import { enforceRateLimit, ipBucket } from '$lib/server/rateLimit';
import { getPlatformSettings } from '$lib/server/settings';

function startOfToday(): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

// `teamOnly` = the question may proceed but must skip the AI and go straight
// to the team (guest free answers exhausted).
// `platformAdmin` = this asker runs the platform, so callers skip their own
// paid gates too (see the profile wallet gate in [leader]/+page.server.ts).
// Surfaced from here so the admin lookup happens once per ask, not per gate.
type RateLimitResult =
	| { ok: true; teamOnly?: boolean; platformAdmin?: boolean }
	| { ok: false; error: string };

/** Signed-in path: a real daily quota against the citizen's own domain user id.
 * Can't be dodged by clearing cookies or switching devices the way the
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
 * behind the 'ask' flood window. A guest is never told to stop asking. */
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
			return { ok: false, error: 'Too many questions in a short time, please try again in a minute.' };
		}
		return { ok: true, teamOnly: true };
	}

	await db.insert(aiAskEvents).values({ anonId, ipAddress: ip });
	return { ok: true };
}

/** Whether this account is a platform admin, who is exempt from the ask caps
 * (they run the platform, test the feature, and answer the questions it can't).
 * Checked here rather than at each call site so no caller can forget it. */
async function isPlatformAdmin(domainUserId: number): Promise<boolean> {
	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.id, domainUserId), isNotNull(users.adminAt)));
	return !!row;
}

/** domainUserId is the signed-in citizen's numeric users.id (null for a
 * guest). The caller already resolves this via getDomainUser for the ask
 * action's own grounding lookup, so it's passed in rather than re-derived. */
export async function enforceAskRateLimit(event: RequestEvent, domainUserId: number | null): Promise<RateLimitResult> {
	// Platform admins ask without limit. The attempt is still recorded, so the
	// ask log stays a complete picture of AI spend. It's simply never checked
	// against a cap for them.
	if (domainUserId && (await isPlatformAdmin(domainUserId))) {
		await db.insert(aiAskEvents).values({ userId: domainUserId });
		return { ok: true, platformAdmin: true };
	}

	const settings = await getPlatformSettings();
	return domainUserId
		? enforceUserAskLimit(domainUserId, settings.userAskDailyLimit)
		: enforceGuestAskLimit(event, settings.guestAskLifetimeLimit);
}
