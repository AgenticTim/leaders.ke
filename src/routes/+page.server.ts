import { fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ballotSimulations, campaigns, pledges, users } from '$lib/server/db/schema';
import { counties, findCountyBySlug, findConstituencyBySlug, findWardBySlug, geoSlug } from '$lib/data/geo';
import { BALLOT_LEVELS, resolveCandidates, type BallotLevel } from '$lib/server/ballot';
import { getDomainUser } from '$lib/server/leader';
import type { Actions, PageServerLoad } from './$types';

function publicId(): string {
	return randomBytes(6).toString('hex'); // 12 hex chars, matches ballotSimulations.publicId(12)
}

/** Anonymous device id for the long-lived 'anon_id' cookie: 32 hex chars. */
function anonDeviceId(): string {
	return randomBytes(16).toString('hex');
}

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
		const domainUser = event.locals.user ? await getDomainUser(event.locals.user.id) : undefined;
		let anonId: string | null = null;
		if (!domainUser) {
			anonId = event.cookies.get('anon_id') ?? null;
			if (!anonId) {
				anonId = anonDeviceId();
				event.cookies.set('anon_id', anonId, {
					path: '/',
					httpOnly: true,
					maxAge: 60 * 60 * 24 * 365
				});
			}
		}

		// Abuse-detection metadata only, never identity.
		let ip: string | null = null;
		try {
			ip = event.getClientAddress();
		} catch {
			ip = null;
		}
		const userAgent = event.request.headers.get('user-agent')?.slice(0, 255) ?? null;

		const id = publicId();
		const [simulation] = await db
			.insert(ballotSimulations)
			.values({
				publicId: id,
				userId: domainUser?.id ?? null,
				anonId,
				ip,
				county,
				constituency,
				ward,
				selections
			})
			.returning({ id: ballotSimulations.id });

		const pledgedCampaignIds = [
			...new Set(
				BALLOT_LEVELS.map((level) => selections[level])
					.filter((s): s is string => !!s && s.startsWith('campaign:'))
					.map((s) => Number(s.slice('campaign:'.length)))
					.filter((n) => Number.isInteger(n))
			)
		];

		for (const campaignId of pledgedCampaignIds) {
			// Only pledge to a live, verified run (the ballot only ever offered these).
			const [campaign] = await db
				.select({ id: campaigns.id })
				.from(campaigns)
				.innerJoin(users, eq(campaigns.subjectUserId, users.id))
				.where(and(eq(campaigns.id, campaignId), isNotNull(campaigns.verifiedAt), isNull(campaigns.deletedAt), isNull(users.deletedAt)));
			if (!campaign) continue;

			// The partial unique indexes keep one live pledge per (campaign, user/anon device);
			// a repeat submission just keeps the existing pledge.
			await db
				.insert(pledges)
				.values({
					userId: domainUser?.id ?? null,
					anonId,
					campaignId: campaign.id,
					simulationId: simulation.id,
					ip,
					userAgent
				})
				.onConflictDoNothing();
		}

		// Signed-in citizens see their result straight away; a guest's ballot is
		// already saved (tagged with their anon_id) but they need an account to
		// come back and see it change as their leaders perform, the signup detour
		// claims this exact ballot the moment they create one (claimGuestBallots).
		if (domainUser) redirect(302, `/ballot/${id}`);
		redirect(302, `/signup?next=${encodeURIComponent(`/ballot/${id}`)}&intent=ballot`);
	}
};
