import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { creditTransactions, wallets } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { listProfiles, type ProfileSort } from '$lib/server/profiles';
import { getPageSize } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

const SORTS: ProfileSort[] = ['recent', 'name', 'position', 'region', 'status', 'source', 'verified'];

// Admin "Profiles" — one row per leader person, merging the old candidates /
// verifications / claims tabs. Search (`q`) spans name, slug, seat and manager;
// sort spans every visible column, default `recent` (newest activity first).
export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	const pageSize = await getPageSize();
	const params = event.url.searchParams;
	const page = Math.max(1, Number(params.get('page') ?? 1));
	const q = params.get('q') ?? '';
	const sortParam = params.get('sort') ?? '';
	const sort: ProfileSort = SORTS.includes(sortParam as ProfileSort) ? (sortParam as ProfileSort) : 'recent';
	const dir = params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : undefined;
	const { profiles, total } = await listProfiles(page, pageSize, { q, sort, dir });
	return { profiles, total, page, pageSize, q, sort, dir: dir ?? (sort === 'recent' ? 'desc' : 'asc') };
};

export const actions: Actions = {
	// Manual credit grant — the only way to fund a wallet today (docs/ai-chat-costs.md
	// notes there's no Paystack top-up flow yet). Upserts the wallet (profile-scoped,
	// not campaign-scoped, so this works even before a run is declared) and logs
	// the grant as a 'topup' transaction, same ledger the AI Chat spend writes to.
	grantCredits: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const profileId = Number(form.get('profileId') ?? 0);
		const amount = Number(form.get('amount') ?? 0);
		if (!profileId) return fail(400, { error: 'Missing profile.' });
		if (!Number.isInteger(amount) || amount <= 0) return fail(400, { error: 'Enter a whole number of credits greater than 0.' });

		const [wallet] = await db.select().from(wallets).where(eq(wallets.subjectUserId, profileId));
		const newBalance = (wallet?.balance ?? 0) + amount;

		await db.transaction(async (tx) => {
			if (wallet) {
				await tx.update(wallets).set({ balance: newBalance, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
			} else {
				await tx.insert(wallets).values({ subjectUserId: profileId, balance: newBalance });
			}
			const [w] = await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.subjectUserId, profileId));
			await tx.insert(creditTransactions).values({
				walletId: w.id,
				kind: 'topup',
				amount,
				reference: 'admin_grant',
				balanceAfter: newBalance
			});
		});

		return { granted: true, profileId, newBalance };
	}
};
