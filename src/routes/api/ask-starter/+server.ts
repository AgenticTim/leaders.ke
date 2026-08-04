// Starter click-through logging (plans/10-platform-wide-ai-chat.md): which
// suggested prompt a visitor actually tapped in the Ask panel. Pure product
// signal (which starters earn their place in the rotation), so it's fire and
// forget: the client never waits on it, and a failure must never stop the
// question itself from being asked.
import { json } from '@sveltejs/kit';
import { getAnonId } from '$lib/server/anonId';
import { db } from '$lib/server/db';
import { askStarterClicks } from '$lib/server/db/schema';
import { getDomainUser } from '$lib/server/leader';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const starter = String(body.starter ?? '').trim().slice(0, 255);
	if (!starter) return json({ ok: false });

	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;
	// Read-only on the cookie: logging a click shouldn't be what mints a
	// visitor's device id, that belongs to their first actual ask.
	await db.insert(askStarterClicks).values({ starter, userId: viewer?.id ?? null, anonId: getAnonId(cookies) });
	return json({ ok: true });
};
