import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ballotSimulations, campaigns, pledges, users } from '$lib/server/db/schema';
import { findCountyBySlug, findConstituencyBySlug, findWardBySlug } from '$lib/data/geo';
import { getDomainUser } from '$lib/server/leader';
import { BALLOT_LEVELS, newBallotPublicId, resolveCandidateById, resolveVoterIdentity, type BallotLevel } from '$lib/server/ballot';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const [row] = await db
		.select()
		.from(ballotSimulations)
		.where(eq(ballotSimulations.publicId, event.params.publicId));

	if (!row) error(404, 'Ballot not found');

	const selections = row.selections as Record<BallotLevel, string | null>;

	const results = await Promise.all(
		BALLOT_LEVELS.map(async (level) => ({
			level,
			candidate: await resolveCandidateById(selections[level] ?? null)
		}))
	);

	// Only the caster (once linked to an account) sees this as "already saved";
	// everyone else (a guest, or a signed-in visitor on a friend's shared link)
	// gets the Save Vote CTA instead.
	const viewer = event.locals.user ? await getDomainUser(event.locals.user.id) : undefined;
	const isOwnBallot = !!viewer && viewer.id === row.userId;

	return {
		publicId: row.publicId,
		countyName: findCountyBySlug(row.county)?.name ?? row.county,
		constituencyName: findConstituencyBySlug(row.constituency)?.name ?? row.constituency,
		wardName: findWardBySlug(row.ward)?.name ?? row.ward,
		results,
		isOwnBallot
	};
};

export const actions: Actions = {
	// Any visitor can pledge to any candidate shown on any ballot page, using their
	// own identity (userId or anon_id), independent of who cast this particular
	// ballot, same "account-less funnel" idiom as Follow, not tied to the simulator.
	pledge: async (event) => {
		const form = await event.request.formData();
		const campaignId = Number(form.get('campaignId'));
		if (!Number.isInteger(campaignId)) return fail(400, { pledgeError: 'Invalid candidate.' });

		// Only a live, verified run is pledge-able (the ballot only ever offered these).
		const [campaign] = await db
			.select({ id: campaigns.id })
			.from(campaigns)
			.innerJoin(users, eq(campaigns.subjectUserId, users.id))
			.where(and(eq(campaigns.id, campaignId), isNotNull(campaigns.verifiedAt), isNull(campaigns.deletedAt), isNull(users.deletedAt)));
		if (!campaign) return fail(400, { pledgeError: 'This candidate is no longer available.' });

		const [simulation] = await db
			.select({ id: ballotSimulations.id })
			.from(ballotSimulations)
			.where(eq(ballotSimulations.publicId, event.params.publicId));

		const { domainUser, anonId, ip } = await resolveVoterIdentity(event);
		const userAgent = event.request.headers.get('user-agent')?.slice(0, 255) ?? null;

		// The partial unique indexes keep one live pledge per (campaign, user/anon
		// device), a repeat submission just keeps the existing pledge.
		await db
			.insert(pledges)
			.values({
				userId: domainUser?.id ?? null,
				anonId,
				campaignId: campaign.id,
				simulationId: simulation?.id ?? null,
				ip,
				userAgent
			})
			.onConflictDoNothing();

		return { pledged: true, campaignId };
	},

	// "Save Vote": a guest gets sent to create an account (back here once done, see
	// ?save=1 on the ballot page); a signed-in visitor gets their own copy of this
	// exact ballot (so it lands on their My Vote), unless it's already theirs.
	saveVote: async (event) => {
		const { domainUser, ip } = await resolveVoterIdentity(event);
		if (!domainUser) {
			redirect(302, `/signup?next=${encodeURIComponent(`/ballot/${event.params.publicId}?save=1`)}&intent=ballot`);
		}

		const [row] = await db.select().from(ballotSimulations).where(eq(ballotSimulations.publicId, event.params.publicId));
		if (!row) error(404, 'Ballot not found');

		if (row.userId === domainUser.id) redirect(302, `/ballot/${row.publicId}`);

		const newId = newBallotPublicId();
		await db.insert(ballotSimulations).values({
			publicId: newId,
			userId: domainUser.id,
			anonId: null,
			ip,
			county: row.county,
			constituency: row.constituency,
			ward: row.ward,
			selections: row.selections
		});

		redirect(302, `/ballot/${newId}`);
	}
};
