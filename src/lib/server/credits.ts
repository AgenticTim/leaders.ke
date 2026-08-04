// Credit wallet operations (TODO #5.1): a campaign's send credits live on a single
// `wallets` row per person, with every movement double-entered into
// `creditTransactions` (signed amount + balanceAfter snapshot) for audit. Broadcast
// dispatch spends through here; topups elsewhere still write the same shape.
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { creditTransactions, wallets } from '$lib/server/db/schema';

/** Current balance for a person's wallet (0 if they have none yet). */
export async function getBalance(subjectUserId: number): Promise<number> {
	const [w] = await db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.subjectUserId, subjectUserId));
	return w?.balance ?? 0;
}

/**
 * Spends `amount` credits from a person's wallet for `channel`, atomically: the
 * balance is decremented with a guarded UPDATE (WHERE balance >= amount) so two
 * concurrent sends can't overdraw, and a `spend` transaction is logged. Returns
 * the new balance, or { ok: false } when the wallet can't cover it. A zero-cost
 * spend (email) is a no-op success. Nothing to move, nothing to log.
 */
export async function spendCredits(
	subjectUserId: number,
	amount: number,
	channel: string,
	reference: string
): Promise<{ ok: true; balanceAfter: number } | { ok: false; error: string }> {
	if (amount <= 0) return { ok: true, balanceAfter: await getBalance(subjectUserId) };

	return db.transaction(async (tx) => {
		const [w] = await tx
			.update(wallets)
			.set({ balance: sql`${wallets.balance} - ${amount}`, updatedAt: new Date() })
			.where(sql`${wallets.subjectUserId} = ${subjectUserId} and ${wallets.balance} >= ${amount}`)
			.returning({ id: wallets.id, balance: wallets.balance });
		if (!w) return { ok: false as const, error: 'Insufficient credits.' };

		await tx.insert(creditTransactions).values({
			walletId: w.id,
			kind: 'spend',
			amount: -amount,
			channel,
			reference,
			balanceAfter: w.balance
		});
		return { ok: true as const, balanceAfter: w.balance };
	});
}

/** Returns `amount` credits to a wallet, used when a paid send was charged but
 * then failed at the provider, so the campaign isn't billed for a message that
 * never left. Logged as a `refund` transaction. */
export async function refundCredits(subjectUserId: number, amount: number, channel: string, reference: string): Promise<void> {
	if (amount <= 0) return;
	await db.transaction(async (tx) => {
		const [w] = await tx
			.update(wallets)
			.set({ balance: sql`${wallets.balance} + ${amount}`, updatedAt: new Date() })
			.where(eq(wallets.subjectUserId, subjectUserId))
			.returning({ id: wallets.id, balance: wallets.balance });
		if (!w) return;
		await tx.insert(creditTransactions).values({
			walletId: w.id,
			kind: 'refund',
			amount,
			channel,
			reference,
			balanceAfter: w.balance
		});
	});
}
