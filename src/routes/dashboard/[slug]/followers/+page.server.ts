import { fail } from '@sveltejs/kit';
import { and, desc, eq, gte, isNull, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { followers, pledges, users } from '$lib/server/db/schema';
import { requireLeader } from '$lib/server/dashboard';
import { createInvite, getPersonTier, listOpenInvites } from '$lib/server/invites';
import { getPackageFeatures } from '$lib/server/packages';
import { addCitizenFollower } from '$lib/server/ambassador';
import { getRunCampaign } from '$lib/server/leader';
import { counties } from '$lib/data/geo';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export type HeatmapRow = { county: string; pledges: number; registeredVoters: number };

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
		pledgeCount: pledgeCountRow?.n ?? 0,
		heatmapUnlocked,
		heatmap
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
