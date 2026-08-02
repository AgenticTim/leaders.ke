import { fail } from '@sveltejs/kit';
import { and, desc, eq, gte, isNull, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { followers, pledges, users } from '$lib/server/db/schema';
import { requireLeader } from '$lib/server/dashboard';
import { createInvite, getPersonTier, listOpenInvites } from '$lib/server/invites';
import { getPackageFeatures } from '$lib/server/packages';
import { addCitizenFollower } from '$lib/server/ambassador';
import { getRunCampaign } from '$lib/server/leader';
import { counties, geoSlug, findCountyBySlug } from '$lib/data/geo';
import { ASSUMED_TURNOUT_2027, votesToWin } from '$lib/data/demographics';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export type HeatmapRow = { county: string; pledges: number; registeredVoters: number };
export type AreaRow = { area: string; pledges: number; registeredVoters: number };

/** The seat's own patch, for ward-level penetration: a county seat (governor/
 * senator/woman rep) gets every ward in the county, an MP their constituency's
 * wards, an MCA just theirs — plus the county name that scopes pledger
 * accounts and the seat's own electorate. Null for national seats (the county
 * heatmap already covers those). */
function seatWardScope(regionLabel: string): { countyName: string; wards: { name: string; voters: number }[]; electorate: number } | null {
	const slug = geoSlug(regionLabel);
	const county = findCountyBySlug(slug);
	if (county) {
		return {
			countyName: county.name,
			wards: county.constituencies.flatMap((c) => c.wards.map((w) => ({ name: w.name, voters: w.voters }))),
			electorate: county.voters
		};
	}
	for (const c of counties) {
		const constituency = c.constituencies.find((k) => geoSlug(k.seatName) === slug);
		if (constituency) {
			return {
				countyName: c.name,
				wards: constituency.wards.map((w) => ({ name: w.name, voters: w.voters })),
				electorate: constituency.voters
			};
		}
		for (const k of c.constituencies) {
			const ward = k.wards.find((w) => geoSlug(w.seatName) === slug);
			if (ward) return { countyName: c.name, wards: [{ name: ward.name, voters: ward.voters }], electorate: ward.voters };
		}
	}
	return null;
}

/** Pledges to this run by the pledger's account ward, scoped to the seat's own
 * county (account county must match, so a "Township" in another county never
 * pollutes the rows). Every scope ward is listed even at 0 pledges. */
async function wardHeatmap(campaignId: number | null, scope: NonNullable<ReturnType<typeof seatWardScope>>): Promise<AreaRow[]> {
	const rows = campaignId
		? await db
				.select({ ward: users.ward, n: count() })
				.from(pledges)
				.innerJoin(users, eq(pledges.userId, users.id))
				.where(and(eq(pledges.campaignId, campaignId), isNull(pledges.deletedAt), eq(users.county, scope.countyName)))
				.groupBy(users.ward)
		: [];
	const byWard = new Map(rows.filter((r): r is { ward: string; n: number } => !!r.ward).map((r) => [r.ward, r.n]));
	return scope.wards
		.map((w) => ({ area: w.name, pledges: byWard.get(w.name) ?? 0, registeredVoters: w.voters }))
		.sort((a, b) => b.pledges - a.pledges || a.area.localeCompare(b.area));
}

/** Every county (geo.ts's real 2022 register), each against live pledges to
 * this person's active-cycle run grouped by the pledging citizen's own account
 * county (set on their Account page — the richer, always-current geo signal
 * now that pledging requires an account, rather than the one-off
 * contact-capture constituency/ward columns pledges itself carries, dead
 * weight since pledging stopped taking anonymous name/contact forms). Every
 * county is included even at 0 pledges — including when there's no campaign
 * at all yet (campaignId null): the map still reads as "here's the ground
 * you'll need to cover", not just a leaderboard of hits. Sorted by pledge
 * count, most first, then by county name. */
async function voterHeatmap(campaignId: number | null): Promise<HeatmapRow[]> {
	const rows = campaignId
		? await db
				.select({ county: users.county, n: count() })
				.from(pledges)
				.innerJoin(users, eq(pledges.userId, users.id))
				.where(and(eq(pledges.campaignId, campaignId), isNull(pledges.deletedAt)))
				.groupBy(users.county)
		: [];

	const pledgesByCounty = new Map(rows.filter((r): r is { county: string; n: number } => !!r.county).map((r) => [r.county, r.n]));
	return counties
		.map((c) => ({ county: c.name, pledges: pledgesByCounty.get(c.name) ?? 0, registeredVoters: c.voters }))
		.sort((a, b) => b.pledges - a.pledges || a.county.localeCompare(b.county));
}

// Follower roster with geo segments; geo values feed the broadcast targeting UI too.
// Ward filtering happens server-side so it composes correctly with pagination.
export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	const pageSize = await getPageSize();

	const target = and(
		eq(followers.digest, 'leader'),
		eq(followers.digestId, ctx.profileUser.id),
		isNull(followers.deletedAt)
	);

	const ward = event.url.searchParams.get('ward') || null;
	const page = Math.max(1, Number(event.url.searchParams.get('page') ?? 1));
	const filtered = ward ? and(target, eq(followers.ward, ward)) : target;

	const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	// Admin-toggled perk (packages.features.voterHeatmap — same fact /pricing
	// shows), not a hardcoded tier name: flipping the toggle changes both
	// pages together. Count is real either way; only the breakdown is gated.
	const tier = await getPersonTier(ctx.profileUser.id);
	const heatmapUnlocked = !!(await getPackageFeatures(tier))?.voterHeatmap;
	const campaign = await getRunCampaign(ctx.profileUser.id);

	const [rows, [weekRow], [totalRow], wardRows, openInvites, [pledgeCountRow], heatmap] = await Promise.all([
		db
			.select()
			.from(followers)
			.where(filtered)
			.orderBy(desc(followers.createdAt))
			.limit(pageSize)
			.offset((page - 1) * pageSize),
		db.select({ n: count() }).from(followers).where(and(target, gte(followers.createdAt, weekAgo))),
		db.select({ n: count() }).from(followers).where(filtered),
		db.selectDistinct({ ward: followers.ward }).from(followers).where(target),
		listOpenInvites(ctx.profileUser.id),
		campaign
			? db.select({ n: count() }).from(pledges).where(and(eq(pledges.campaignId, campaign.id), isNull(pledges.deletedAt)))
			: Promise.resolve([{ n: 0 }]),
		heatmapUnlocked ? voterHeatmap(campaign?.id ?? null) : Promise.resolve([])
	]);

	// Seat-scoped analytics (Dominate): ward penetration, opportunity ranking,
	// and the votes-to-win benchmark — all against the seat's OWN electorate.
	const scope = heatmapUnlocked && ctx.position ? seatWardScope(ctx.position.region) : null;
	const wardHeat = scope ? await wardHeatmap(campaign?.id ?? null, scope) : null;
	const electorate = scope ? scope.electorate : counties.reduce((sum, c) => sum + c.voters, 0);
	const pledgeCount = pledgeCountRow?.n ?? 0;
	// "Campaign next": the biggest pools of voters you haven't reached, from
	// the seat's own wards (or counties, for a national seat).
	const opportunityRows: AreaRow[] = wardHeat ?? heatmap.map((r) => ({ area: r.county, pledges: r.pledges, registeredVoters: r.registeredVoters }));
	const opportunities = [...opportunityRows]
		.sort((a, b) => (b.registeredVoters - b.pledges) - (a.registeredVoters - a.pledges))
		.slice(0, 5)
		.map((r) => ({ ...r, untapped: r.registeredVoters - r.pledges }));

	return {
		followers: rows.map((f) => ({
			id: f.id,
			name: f.name ?? 'Follower',
			email: f.emailAddress,
			phone: f.phoneNumber,
			county: f.county,
			ward: f.ward,
			channels: [f.email && 'email', f.sms && 'sms', f.whatsapp && 'whatsapp'].filter(
				Boolean
			) as string[],
			joinedAt: f.createdAt.toISOString()
		})),
		newThisWeek: weekRow.n,
		total: totalRow.n,
		page,
		pageSize,
		ward,
		wards: wardRows.map((w) => w.ward).filter((w): w is string => !!w).sort(),
		followerInvites: openInvites.filter((i) => i.role === 'follower'),
		pledgeCount,
		heatmapUnlocked,
		heatmap,
		wardHeat,
		wardScopeCounty: scope?.countyName ?? null,
		opportunities: heatmapUnlocked ? opportunities : [],
		seatStats: heatmapUnlocked
			? {
					electorate,
					votesToWin: votesToWin(electorate),
					turnoutAssumption: ASSUMED_TURNOUT_2027,
					coverage: pledgeCount / votesToWin(electorate)
				}
			: null
	};
};

export const actions: Actions = {
	inviteFollower: async (event) => {
		const { domainUser, ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!email) return fail(400, { error: 'Enter an email address to invite.' });

		await createInvite(ctx.profileUser.id, 'follower', domainUser.id, email, event.url.origin);
		return { invited: { email } };
	},

	// Same add-a-citizen flow ambassadors have on /dashboard/mobilize — managers
	// recruit too (blueprint funnel A), attributed via followers.addedBy.
	addFollower: async (event) => {
		const { domainUser, ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const result = await addCitizenFollower(domainUser.id, ctx.profileUser.id, {
			name: String(form.get('name') ?? ''),
			phone: String(form.get('phone') ?? ''),
			email: String(form.get('email') ?? ''),
			county: String(form.get('county') ?? '').trim() || null,
			ward: String(form.get('ward') ?? '').trim() || null
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { added: { name: result.name } };
	}
};
