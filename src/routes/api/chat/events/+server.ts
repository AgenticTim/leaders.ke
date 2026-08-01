// Live chat pings (SSE): a connection per open chat view. When a message
// lands in a matching thread the client gets a "bump" and re-fetches its own
// thread data (invalidate('chat:thread')) — the stream carries no message
// content, so there's nothing to leak and auth stays with the loaders.
//
//   ?person=<users.id>              citizen view: pings only for the viewer's
//                                   own thread with that leader (session user
//                                   or anon_id device cookie)
//   ?person=<users.id>&role=team    team view (Respond tab): pings for every
//                                   thread of that leader — admin or active
//                                   manager only
import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { getAnonId } from '$lib/server/anonId';
import { subscribeChatEvents } from '$lib/server/chatEvents';
import { db } from '$lib/server/db';
import { managers } from '$lib/server/db/schema';
import { getDomainUser } from '$lib/server/leader';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const personId = Number(url.searchParams.get('person') ?? 0);
	if (!personId) error(400, 'person is required');
	const team = url.searchParams.get('role') === 'team';

	const viewer = locals.user ? await getDomainUser(locals.user.id) : null;
	const anonId = getAnonId(cookies);

	if (team) {
		const allowed =
			!!viewer &&
			(!!viewer.adminAt ||
				viewer.id === personId ||
				!!(
					await db
						.select({ id: managers.id })
						.from(managers)
						.where(
							and(
								eq(managers.userId, viewer.id),
								eq(managers.subjectUserId, personId),
								eq(managers.isActive, true),
								isNull(managers.deletedAt)
							)
						)
				)[0]);
		if (!allowed) error(403, 'Not a team member for this profile.');
	} else if (!viewer && !anonId) {
		// A guest with no device cookie has no thread to stream yet — the cookie
		// is minted by their first ask, after which the page reconnects.
		error(403, 'No chat identity yet.');
	}

	let cleanup = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup(); // connection already gone
				}
			};
			send('retry: 3000\n\n');

			const unsubscribe = subscribeChatEvents((e) => {
				if (e.personId !== personId) return;
				// Citizen connections only hear their own thread.
				if (!team) {
					const mine =
						(viewer !== null && e.userId === viewer.id) ||
						(viewer === null && anonId !== null && e.anonId === anonId);
					if (!mine) return;
				}
				if (e.kind === 'typing') {
					// Only the OTHER side's keyboard matters — no echo of your own.
					if (team ? e.from !== 'citizen' : e.from !== 'team') return;
					send(`event: typing\ndata: ${e.conversationId}\n\n`);
					return;
				}
				send('data: bump\n\n');
			});
			// Comment-only keepalive so idle proxies don't cut the stream.
			const heartbeat = setInterval(() => send(': keepalive\n\n'), 25000);
			cleanup = () => {
				unsubscribe();
				clearInterval(heartbeat);
			};
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
