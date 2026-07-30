import { fail } from '@sveltejs/kit';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { creditTransactions, subscriptions, wallets } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { listProfiles, type ProfileSort } from '$lib/server/profiles';
import { SUBSCRIPTION_TIERS } from '$lib/server/packages';
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
	},

	// Admin package override — the only way to change a profile's tier without a
	// real Paystack charge (support/testing/goodwill comps). Cancels whatever
	// subscription is currently live (audit trail preserved, same "supersede,
	// never mutate" convention as packages.ts's rate history) and inserts a
	// fresh one, amount 0 and paymentMethod flagged so it's obviously not a real
	// payment in any ledger/report. A full year out keeps the renewal sweep from
	// nagging the admin (the row's payer) to "renew" a comp any time soon.
	setSubscription: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const profileId = Number(form.get('profileId') ?? 0);
		const tier = String(form.get('tier') ?? '');
		if (!profileId) return fail(400, { error: 'Missing profile.' });
		if (!SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number])) {
			return fail(400, { error: 'Invalid package.' });
		}

		const [current] = await db
			.select({ id: subscriptions.id, tier: subscriptions.tier })
			.from(subscriptions)
			.where(and(eq(subscriptions.subjectUserId, profileId), or(eq(subscriptions.status, 'active'), eq(subscriptions.status, 'pending'))))
			.orderBy(desc(subscriptions.endsAt))
			.limit(1);

		const tierRank = (t: string) => SUBSCRIPTION_TIERS.indexOf(t as (typeof SUBSCRIPTION_TIERS)[number]);
		const origin = !current ? 'new' : tierRank(tier) > tierRank(current.tier) ? 'upgrade' : tierRank(tier) < tierRank(current.tier) ? 'downgrade' : 'renewal';

		const now = new Date();
		const endsAt = new Date(now);
		endsAt.setFullYear(endsAt.getFullYear() + 1);

		await db.transaction(async (tx) => {
			if (current) {
				await tx.update(subscriptions).set({ status: 'cancelled', cancelledAt: now, updatedAt: now }).where(eq(subscriptions.id, current.id));
			}
			await tx.insert(subscriptions).values({
				subjectUserId: profileId,
				payerId: admin.domainUser.id,
				tier: tier as (typeof SUBSCRIPTION_TIERS)[number],
				billingCycle: 'monthly',
				amount: 0,
				status: 'active',
				origin,
				startAt: now,
				endsAt,
				paidAt: now,
				paymentMethod: 'admin_override',
				previousSubscriptionId: current?.id
			});
		});

		return { subscriptionSet: true, profileId, tier };
	}
};
