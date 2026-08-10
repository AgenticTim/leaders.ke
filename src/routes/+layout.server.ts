import { env } from '$env/dynamic/private';
import { googleAuthEnabled } from '$lib/server/auth';
import { getDomainUser } from '$lib/server/leader';
import type { LayoutServerLoad } from './$types';

// Expose the session user to every page so the Header can switch Log in / Log out,
// plus the one-shot flash notice (consumed by hooks) for whichever page renders it.
// googleEnabled rides along for AuthModal, which can open on any page.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	// Reference the URL so this load re-runs on every client-side navigation,
	// otherwise a flash set during a redirect is consumed by hooks but never
	// reaches the banner (stale `flash: null` from the previous navigation).
	void url.pathname;

	// DialAnApp dial widget: the site token is served to platform admins only,
	// so the builder-agent button never renders for regular users.
	let dialToken: string | null = null;
	if (locals.user && env.DIALANAPP_TOKEN) {
		const domainUser = await getDomainUser(locals.user.id);
		if (domainUser?.adminAt) dialToken = env.DIALANAPP_TOKEN;
	}

	return {
		user: locals.user ?? null,
		flash: locals.flash ?? null,
		googleEnabled: googleAuthEnabled,
		dialToken
	};
};
