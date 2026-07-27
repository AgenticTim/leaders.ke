import { fail, redirect } from '@sveltejs/kit';
import { requireDashboardUser } from '$lib/server/dashboard';
import { acceptInvite, inviteDestination, joinedBannerQuery, listInvitesForEmail } from '$lib/server/invites';
import { listNotifications, markNotificationsRead } from '$lib/server/notifications';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { domainUser, authUser } = await requireDashboardUser(event);
	const pageSize = await getPageSize();
	const page = Math.max(1, Number(event.url.searchParams.get('page') ?? 1));
	const invitePage = Math.max(1, Number(event.url.searchParams.get('invitePage') ?? 1));

	const [{ invites, total: inviteTotal }, { items: notifications, total: notifTotal }] = await Promise.all([
		listInvitesForEmail(authUser.email, invitePage, pageSize),
		listNotifications(domainUser.id, page, pageSize)
	]);

	return { invites, inviteTotal, invitePage, notifications, notifTotal, page, pageSize };
};

export const actions: Actions = {
	accept: async (event) => {
		const { domainUser, authUser } = await requireDashboardUser(event);
		const form = await event.request.formData();
		const token = String(form.get('token') ?? '');
		if (!token) return fail(400, { error: 'Invalid invite.' });

		const result = await acceptInvite(token, domainUser.id, authUser.email);
		if (!result.ok) return fail(400, { error: result.error });

		redirect(302, `${inviteDestination(result.role, result.dashboardBase, result.subjectId)}?${joinedBannerQuery(result.role, result.leaderName)}`);
	},

	// Dismisses one dashboard notification banner (marks it read). A plain form POST
	// so it works without JS, postable from any dashboard page since the banner
	// itself is rendered by the shared layout, not just this tab.
	dismiss: async (event) => {
		const { domainUser } = await requireDashboardUser(event);
		const form = await event.request.formData();
		const id = Number(form.get('id'));
		if (Number.isInteger(id)) await markNotificationsRead(domainUser.id, [id]);

		const back = event.request.headers.get('referer');
		const path = back && new URL(back).origin === event.url.origin ? new URL(back).pathname : '/dashboard';
		redirect(303, path);
	}
};
