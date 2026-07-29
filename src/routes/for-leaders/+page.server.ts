import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, positions, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE } from '$lib/server/leader';
import type { PageServerLoad } from './$types';

// Live platform stats for the hero card — real counts, not marketing copy, so
// a campaign team spot-checking their county finds exactly what we claim.
export const load: PageServerLoad = async () => {
	const [[{ n: positionCount }], [{ n: profileCount }], [{ n: campaignCount }]] = await Promise.all([
		db.select({ n: count() }).from(positions),
		db.select({ n: count() }).from(users).where(and(isNotNull(users.slug), isNull(users.deletedAt))),
		db
			.select({ n: count() })
			.from(campaigns)
			.where(and(eq(campaigns.cycleYear, ACTIVE_CYCLE), isNull(campaigns.deletedAt)))
	]);

	return { positionCount, profileCount, campaignCount };
};
