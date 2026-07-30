// Form spam protection (TODO #5.4): a DB-backed sliding-window rate limit for the
// public write forms (follow, pledge, endorse, donate). Each accepted submission
// records a `rate_events` row per bucket (the caller's IP, and separately their
// contact/identifier); a new attempt is refused when any of its buckets already
// has too many rows inside the window. Same approach as password_reset_requests,
// generalized — no external captcha dependency, works behind the VPS.
import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rateEvents } from '$lib/server/db/schema';
import type { RequestEvent } from '@sveltejs/kit';

export type RateAction = 'follow' | 'pledge' | 'endorse' | 'donate';

// Per-action window and max accepted submissions per bucket within it. Deliberately
// generous: these stop scripted floods, not a person clicking twice.
const LIMITS: Record<RateAction, { windowMs: number; max: number }> = {
	follow: { windowMs: 60_000, max: 5 },
	pledge: { windowMs: 60_000, max: 5 },
	endorse: { windowMs: 60_000, max: 5 },
	donate: { windowMs: 60_000, max: 10 }
};

/** The caller's IP as a rate-limit bucket, or a stable fallback when unavailable. */
export function ipBucket(event: RequestEvent): string {
	try {
		return `ip:${event.getClientAddress()}`;
	} catch {
		return 'ip:unknown';
	}
}

async function overLimit(action: RateAction, bucket: string, windowMs: number, max: number): Promise<boolean> {
	const since = new Date(Date.now() - windowMs);
	const [{ n }] = await db
		.select({ n: count() })
		.from(rateEvents)
		.where(and(eq(rateEvents.action, action), eq(rateEvents.bucket, bucket), gte(rateEvents.createdAt, since)));
	return n >= max;
}

/**
 * Checks every bucket for `action` and, if all are under their cap, records one
 * event per bucket and returns ok. If any bucket is over, returns
 * `{ ok: false, retryAfter }` (seconds) and records nothing. Empty/blank buckets
 * are ignored (e.g. a form with no contact still gets IP-limited).
 */
export async function enforceRateLimit(
	action: RateAction,
	buckets: string[]
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
	const { windowMs, max } = LIMITS[action];
	const active = buckets.filter((b) => b && !b.endsWith(':'));
	for (const b of active) {
		if (await overLimit(action, b, windowMs, max)) {
			return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
		}
	}
	if (active.length) await db.insert(rateEvents).values(active.map((bucket) => ({ action, bucket })));
	return { ok: true };
}
