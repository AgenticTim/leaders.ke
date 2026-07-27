import { fail, redirect } from '@sveltejs/kit';
import { followLeader } from '$lib/server/follow';
import type { Actions, PageServerLoad } from './$types';

// No UI of its own: FollowCard posts here from any page. Direct GETs bounce home.
export const load: PageServerLoad = () => redirect(302, '/');

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const subjectUserIdRaw = Number(form.get('subjectUserId'));
		const result = await followLeader({
			name: String(form.get('name') ?? ''),
			contact: String(form.get('contact') ?? ''),
			county: String(form.get('county') ?? ''),
			ward: String(form.get('ward') ?? ''),
			subjectUserId: Number.isInteger(subjectUserIdRaw) && subjectUserIdRaw > 0 ? subjectUserIdRaw : undefined,
			candidateId: String(form.get('candidateId') ?? '') || undefined
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { followed: true, name: result.name };
	}
};
