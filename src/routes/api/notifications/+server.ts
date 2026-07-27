import { json, error } from '@sveltejs/kit';
import { getDomainUser } from '$lib/server/leader';
import { countUnreadNotifications } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

// Lazy-loaded by the Header's notification bell, on any page — same rationale as
// /api/switcher: only the unread count is worth fetching on every page view. The
// full history (and open invites) lives on the /dashboard/notifications tab,
// loaded server-side there instead.
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) error(401, 'Not signed in.');
	const domainUser = await getDomainUser(event.locals.user.id);
	if (!domainUser) error(401, 'Not signed in.');

	return json({ unreadCount: await countUnreadNotifications(domainUser.id) });
};
