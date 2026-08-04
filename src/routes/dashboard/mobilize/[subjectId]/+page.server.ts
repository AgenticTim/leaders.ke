// Ambassador workspace for one campaign, a tab on the CITIZEN view (an ambassador
// is a citizen with extra duties. No separate mode/route family). Scoped hard to
// the viewer's own recruits (followers.addedBy = me); the full roster stays a
// manager concern on /dashboard/[slug]/followers. Field work. The events they
// run and the citizen feedback they gather (TODO #17), is likewise their own.
import { error, fail, redirect } from '@sveltejs/kit';
import { requireDashboardUser } from '$lib/server/dashboard';
import {
	addCitizenFollower,
	addCitizenPledge,
	leaveAmbassadorRole,
	listAmbassadorAssignments,
	listRecruitedPledges,
	listRecruits
} from '$lib/server/ambassador';
import {
	createEvent,
	createFeedback,
	deleteOwnEvent,
	listEventsForAmbassador,
	listFeedbackForAmbassador
} from '$lib/server/mobilization';
import { getRunCampaign } from '$lib/server/leader';
import { counties } from '$lib/data/geo';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { domainUser } = await requireDashboardUser(event);
	const subjectId = Number(event.params.subjectId);

	const assignments = await listAmbassadorAssignments(domainUser.id);
	const assignment = assignments.find((a) => a.subjectId === subjectId);
	if (!assignment) error(404, 'You are not an ambassador for this campaign.');

	const pageSize = await getPageSize();
	// Per-tab pagination without four separate params: `tab` names which list the
	// `page` cursor drives; the others load their first page.
	const tab = event.url.searchParams.get('tab') ?? 'followers';
	const page = Math.max(1, Number(event.url.searchParams.get('page') ?? 1));
	const followerPage = tab === 'followers' ? page : 1;
	const pledgePage = tab === 'pledges' ? page : 1;

	// Pledges attach to the person's active-cycle run; without one, the campaign
	// can't take pledges yet (form disabled client-side).
	const campaign = await getRunCampaign(subjectId);
	const [{ recruits, total }, pledgeResult, events, feedback] = await Promise.all([
		listRecruits(domainUser.id, subjectId, followerPage, pageSize),
		campaign
			? listRecruitedPledges(domainUser.id, campaign.id, pledgePage, pageSize)
			: Promise.resolve({ pledges: [], total: 0 }),
		listEventsForAmbassador(domainUser.id, subjectId),
		listFeedbackForAmbassador(domainUser.id, subjectId)
	]);

	return {
		assignment,
		recruits,
		total,
		followerPage,
		pledges: pledgeResult.pledges,
		pledgeTotal: pledgeResult.total,
		pledgePage,
		campaignAcceptsPledges: !!campaign,
		pageSize,
		events,
		feedback,
		countyNames: counties.map((c) => c.name)
	};
};

// Every write re-checks the caller mobilizes for this campaign (the module guards
// too, but bouncing early keeps the failure a clean 403).
async function assertAmbassador(event: Parameters<Actions[string]>[0]) {
	const { domainUser } = await requireDashboardUser(event);
	const subjectId = Number(event.params.subjectId);
	const assignments = await listAmbassadorAssignments(domainUser.id);
	if (!assignments.some((a) => a.subjectId === subjectId)) {
		return { ok: false as const };
	}
	return { ok: true as const, domainUser, subjectId };
}

export const actions: Actions = {
	addFollower: async (event) => {
		const guard = await assertAmbassador(event);
		if (!guard.ok) return fail(403, { error: 'You can only add citizens to campaigns you mobilize for.' });

		const form = await event.request.formData();
		const result = await addCitizenFollower(guard.domainUser.id, guard.subjectId, {
			name: String(form.get('name') ?? ''),
			phone: String(form.get('phone') ?? ''),
			email: String(form.get('email') ?? ''),
			county: String(form.get('county') ?? '').trim() || null,
			ward: String(form.get('ward') ?? '').trim() || null
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { added: { name: result.name } };
	},

	logPledge: async (event) => {
		const guard = await assertAmbassador(event);
		if (!guard.ok) return fail(403, { error: 'You can only add pledges to campaigns you mobilize for.' });

		const campaign = await getRunCampaign(guard.subjectId);
		if (!campaign) return fail(400, { error: 'This campaign is not taking pledges yet.' });

		const form = await event.request.formData();
		const result = await addCitizenPledge(guard.domainUser.id, campaign.id, {
			name: String(form.get('name') ?? ''),
			phone: String(form.get('phone') ?? ''),
			email: String(form.get('email') ?? ''),
			county: String(form.get('county') ?? '').trim() || null,
			ward: String(form.get('ward') ?? '').trim() || null
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { pledged: { name: result.name } };
	},

	logEvent: async (event) => {
		const guard = await assertAmbassador(event);
		if (!guard.ok) return fail(403, { error: 'You can only log events for campaigns you mobilize for.' });

		const form = await event.request.formData();
		const result = await createEvent(guard.domainUser.id, guard.subjectId, {
			title: String(form.get('title') ?? ''),
			description: String(form.get('description') ?? ''),
			county: String(form.get('county') ?? '').trim() || null,
			ward: String(form.get('ward') ?? '').trim() || null,
			scheduledFor: String(form.get('scheduledFor') ?? ''),
			turnout: String(form.get('turnout') ?? '')
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { eventLogged: true };
	},

	deleteEvent: async (event) => {
		const guard = await assertAmbassador(event);
		if (!guard.ok) return fail(403, { error: 'Not allowed.' });
		const form = await event.request.formData();
		const eventId = Number(form.get('eventId') ?? 0);
		if (eventId) await deleteOwnEvent(eventId, guard.domainUser.id);
		return { eventDeleted: true };
	},

	logFeedback: async (event) => {
		const guard = await assertAmbassador(event);
		if (!guard.ok) return fail(403, { error: 'You can only log feedback for campaigns you mobilize for.' });

		const form = await event.request.formData();
		const eventId = Number(form.get('eventId') ?? 0) || null;
		const result = await createFeedback(guard.domainUser.id, guard.subjectId, {
			citizenName: String(form.get('citizenName') ?? ''),
			county: String(form.get('county') ?? '').trim() || null,
			ward: String(form.get('ward') ?? '').trim() || null,
			sentiment: String(form.get('sentiment') ?? 'neutral'),
			message: String(form.get('message') ?? ''),
			eventId
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { feedbackLogged: true };
	},

	leave: async (event) => {
		const { domainUser } = await requireDashboardUser(event);
		const form = await event.request.formData();
		const ambassadorId = Number(form.get('ambassadorId') ?? 0);
		if (!ambassadorId) return fail(400, { error: 'Invalid request.' });

		await leaveAmbassadorRole(ambassadorId, domainUser.id);
		redirect(302, '/dashboard');
	}
};
