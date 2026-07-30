import { error } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { donations } from '$lib/server/db/schema';
import { requireLeader } from '$lib/server/dashboard';
import { buildTreasurerCsv } from '$lib/server/fundraising';
import { fullName, getOrCreateRunCampaign } from '$lib/server/leader';
import type { RequestHandler } from './$types';

// Treasurer CSV: the full donation ledger with per-row fee/net plus payout
// totals, downloaded from the Fundraising tab's report card.
export const GET: RequestHandler = async (event) => {
	const { ctx } = await requireLeader(event);
	if (!ctx.position) error(400, 'Launch a campaign in order to Fundraise.');

	const campaign = await getOrCreateRunCampaign(ctx.profileUser.id, ctx.position.id, ctx.profileUser.id, fullName(ctx.profileUser));
	const rows = await db
		.select()
		.from(donations)
		.where(and(eq(donations.campaignId, campaign.id), isNull(donations.deletedAt)))
		.orderBy(desc(donations.createdAt));

	const today = new Date().toISOString().slice(0, 10);
	return new Response(buildTreasurerCsv(rows), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="fundraising-report-${event.params.slug}-${today}.csv"`
		}
	});
};
