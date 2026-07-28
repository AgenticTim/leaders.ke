import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { ballotSimulations } from '$lib/server/db/schema';
import { counties, findCountyBySlug, findConstituencyBySlug, findWardBySlug, geoSlug } from '$lib/data/geo';
import { BALLOT_LEVELS, newBallotPublicId, resolveCandidates, resolveVoterIdentity, type BallotLevel } from '$lib/server/ballot';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const countySlug = url.searchParams.get('county') ?? '';
	const constituencySlug = url.searchParams.get('constituency') ?? '';
	const wardSlug = url.searchParams.get('ward') ?? '';

	const county = countySlug ? findCountyBySlug(countySlug) : undefined;
	const constituency = county && constituencySlug ? findConstituencyBySlug(constituencySlug) : undefined;
	const ward = constituency && wardSlug ? findWardBySlug(wardSlug) : undefined;

	const geoReady = !!(county && constituency && ward);

	// Progressive booth: every level is always listed, but its candidates are
	// null (locked) until the piece of geography it needs is picked inline.
	const unlockedBy: Record<BallotLevel, boolean> = {
		president: true,
		governor: !!county,
		senator: !!county,
		womanRep: !!county,
		mp: !!constituency,
		mca: !!ward
	};
	const levels = await Promise.all(
		BALLOT_LEVELS.map(async (level) => ({
			level,
			candidates: unlockedBy[level] ? await resolveCandidates(level, { county, constituency, ward }) : null
		}))
	);

	return {
		countySlug,
		constituencySlug,
		wardSlug,
		countyName: county?.name ?? '',
		constituencyName: constituency?.name ?? '',
		wardName: ward?.name ?? '',
		geoReady,
		levels,
		countiesCount: counties.length,
		// Inline picker options: 47 counties always; constituencies/wards filtered
		// by the selection one level up.
		countyOptions: counties.map((c) => ({ slug: geoSlug(c.name), name: c.name })),
		constituencyOptions: county ? county.constituencies.map((c) => ({ slug: geoSlug(c.seatName), name: c.name })) : [],
		wardOptions: constituency ? constituency.wards.map((w) => ({ slug: geoSlug(w.seatName), name: w.name })) : []
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const county = form.get('county')?.toString() ?? '';
		const constituency = form.get('constituency')?.toString() ?? '';
		const ward = form.get('ward')?.toString() ?? '';
		const selectionsRaw = form.get('selections')?.toString() ?? '{}';

		if (!county || !constituency || !ward) {
			return fail(400, { message: 'Select your county, constituency and ward first.' });
		}

		let selections: Record<BallotLevel, string | null>;
		try {
			selections = JSON.parse(selectionsRaw);
		} catch {
			return fail(400, { message: 'Invalid ballot selections.' });
		}

		const hasAnySelection = BALLOT_LEVELS.some((level) => !!selections[level]);
		if (!hasAnySelection) {
			return fail(400, { message: 'Pick at least one candidate before casting your simulated vote.' });
		}

		// Every ballot is tagged with whoever cast it: a signed-in user's id, or (for
		// a guest) the long-lived 'anon_id' device cookie, so a later signup/login
		// can claim it (see claimGuestBallots), even after browsing elsewhere first.
		const { domainUser, anonId, ip } = await resolveVoterIdentity(event);

		const id = newBallotPublicId();
		await db.insert(ballotSimulations).values({
			publicId: id,
			userId: domainUser?.id ?? null,
			anonId,
			ip,
			county,
			constituency,
			ward,
			selections
		});

		// Straight to the shareable result, guest or signed in. Pledging to a
		// candidate and saving the ballot to an account both happen from there
		// (see /ballot/[publicId]), so there's no detour before the payoff.
		redirect(302, `/ballot/${id}`);
	}
};
