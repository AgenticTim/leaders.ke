import { listCurrentPricing, listPackages } from '$lib/server/packages';
import type { PageServerLoad } from './$types';

// Single source of truth: the pricing table's prices, caps and on/off perks
// come straight from the `pricing` and `packages` tables — the same rows
// /dashboard/admin/packages edits. Nothing here is hand-maintained; an admin
// toggle or rate change reflects on this page (and on the actual feature
// gates that read the same tables) without a code change.
export const load: PageServerLoad = async () => {
	return {
		pricing: await listCurrentPricing(),
		packages: await listPackages()
	};
};
