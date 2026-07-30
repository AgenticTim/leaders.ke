// Post-payment fulfillment for STK-push donations (TODO 6.1), the donation
// counterpart of checkoutFulfill.ts: the donate action writes a pending
// donations row carrying a `don_` reference before firing the charge, and the
// signed Paystack webhook flips it here. Status-guarded UPDATEs keep repeated
// webhook deliveries idempotent, and the manual confirm ledger on the
// dashboard Fundraising tab still covers off-platform till payments.
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { donations } from '$lib/server/db/schema';

/** Whether a Paystack reference belongs to a donation charge (vs subscription
 * checkout's `ps_` references) — how the shared webhook routes an event. */
export function isDonationReference(reference: string): boolean {
	return reference.startsWith('don_');
}

export async function confirmDonation(reference: string): Promise<void> {
	await db
		.update(donations)
		.set({ status: 'confirmed', updatedAt: new Date() })
		.where(and(eq(donations.reference, reference), eq(donations.status, 'pending')));
}

/** A declined/timed-out STK prompt: the row stays visible on the campaign's
 * ledger as failed rather than lingering forever as pending. */
export async function failDonation(reference: string): Promise<void> {
	await db
		.update(donations)
		.set({ status: 'failed', updatedAt: new Date() })
		.where(and(eq(donations.reference, reference), eq(donations.status, 'pending')));
}
