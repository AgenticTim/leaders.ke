// The one guest device identity: a single long-lived anon_id cookie shared by
// every guest-facing feature (ballot booth, AI-chat rate limit, chat threads),
// so one visitor is one id across the site. Server-only (httpOnly).
import { randomBytes } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

export const ANON_ID_COOKIE = 'anon_id';

/** The visitor's device id, or null — for read paths (page loads) that must
 * not set cookies. */
export function getAnonId(cookies: Cookies): string | null {
	return cookies.get(ANON_ID_COOKIE) ?? null;
}

/** The visitor's device id, minted (32 hex chars, 1-year cookie) if missing —
 * for actions that need a stable identity going forward. */
export function getOrMintAnonId(cookies: Cookies): string {
	let anonId = cookies.get(ANON_ID_COOKIE);
	if (!anonId) {
		anonId = randomBytes(16).toString('hex');
		cookies.set(ANON_ID_COOKIE, anonId, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
	}
	return anonId;
}

/** The caller's address, or null when the adapter can't determine one (it
 * throws in that case). Paired with the device id above: together they're what
 * distinguishes one anonymous asker from another in the inboxes. Never worth
 * failing a request over, so a failure just yields null. */
export function clientAddress(event: RequestEvent): string | null {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
}
