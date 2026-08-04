import { redirect } from '@sveltejs/kit';
import { postLoginRedirectTarget, requireDashboardUser } from '$lib/server/dashboard';
import type { PageServerLoad } from './$types';

// '/dashboard' root is never rendered, only ever a landing target (login/signup/
// verify all default `next` here, and it's the account switcher's "Citizen"
// entry). It exists so that target stays stable while what it means can change.
// A manager/leader goes straight to their own campaign dash; every other citizen
// (the followed-leaders feed that used to live here folded into /news's
// "Following" filter) lands on My Vote instead.
export const load: PageServerLoad = async (event) => {
	const { domainUser } = await requireDashboardUser(event);
	const target = await postLoginRedirectTarget(event.cookies, domainUser.id);
	redirect(302, target ?? '/dashboard/my-vote');
};
