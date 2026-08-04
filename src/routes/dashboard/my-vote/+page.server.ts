import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ballotSimulations } from '$lib/server/db/schema';
import { requireDashboardUser } from '$lib/server/dashboard';
import { listMyBallots, listMyPledges } from '$lib/server/citizen';
import type { Actions, PageServerLoad } from './$types';

// The citizen mode's "My Vote" tab. The other half of what used to be one
// combined Overview page (see /dashboard for "Local News", which stayed at the
// root path along with the post-login redirect check).
export const load: PageServerLoad = async (event) => {
	const { domainUser } = await requireDashboardUser(event);
	const [pledges, ballots] = await Promise.all([listMyPledges(domainUser.id), listMyBallots(domainUser.id)]);
	return { pledges, ballots };
};

export const actions: Actions = {
	deleteBallot: async (event) => {
		const { domainUser } = await requireDashboardUser(event);
		const form = await event.request.formData();
		const publicId = String(form.get('publicId') ?? '');
		if (!publicId) return fail(400, { error: 'Invalid ballot.' });

		// Scoped to this account's own userId, can't delete a ballot that isn't theirs.
		await db.delete(ballotSimulations).where(and(eq(ballotSimulations.publicId, publicId), eq(ballotSimulations.userId, domainUser.id)));

		return { deleted: true };
	}
};
