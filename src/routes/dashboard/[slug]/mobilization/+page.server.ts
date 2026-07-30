// Manager view of ambassador field work (TODO #17): every event ambassadors have
// logged for this campaign, each with a Confirm button — the "physical-appearance
// confirmation" — plus the citizen feedback feed. requireLeader gates access to
// this person's dashboard, so ctx.profileUser.id IS the subjectUserId to confirm
// against; a manager can never confirm events on a campaign they don't hold.
import { fail } from '@sveltejs/kit';
import { requireLeader } from '$lib/server/dashboard';
import { confirmEvent, listEventsForManager, listFeedbackForManager } from '$lib/server/mobilization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	const [events, feedback] = await Promise.all([
		listEventsForManager(ctx.profileUser.id),
		listFeedbackForManager(ctx.profileUser.id)
	]);
	return { events, feedback };
};

export const actions: Actions = {
	confirm: async (event) => {
		const { domainUser, ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const eventId = Number(form.get('eventId') ?? 0);
		if (!eventId) return fail(400, { error: 'Invalid request.' });

		await confirmEvent(eventId, domainUser.id, ctx.profileUser.id);
		return { confirmed: true };
	}
};
