// Treasurer payout + reconciliation report over a campaign's donation ledger.
// The 5% platform fee here must match the public promise on /fundraising,
// campaigns keep 95% of every confirmed donation, the fee is never returned.
export const PLATFORM_FEE_RATE = 0.05;

export type DonationRow = {
	id: number;
	donorName: string;
	phoneNumber: string | null;
	amount: number; // KES
	status: string;
	reference: string | null;
	createdAt: Date;
};

/** How the money actually moved: a `don_` reference is a Paystack M-Pesa STK
 * charge (webhook-confirmed), anything else was confirmed by the team against
 * their own till statement. */
export function donationChannel(reference: string | null): 'mpesa-stk' | 'manual' {
	return reference?.startsWith('don_') ? 'mpesa-stk' : 'manual';
}

/** Fee is rounded per donation (whole KES) so each CSV row reconciles exactly
 * with the summary totals, which sum the per-row values. */
export function donationFee(amount: number): number {
	return Math.round(amount * PLATFORM_FEE_RATE);
}

export type TreasurerSummary = {
	feeRate: number;
	counts: { confirmed: number; pending: number; failed: number };
	amounts: { confirmed: number; pending: number; failed: number };
	channels: { mpesaStk: { count: number; amount: number }; manual: { count: number; amount: number } };
	grossConfirmed: number;
	platformFee: number;
	netPayable: number;
};

export function buildTreasurerSummary(rows: DonationRow[]): TreasurerSummary {
	const summary: TreasurerSummary = {
		feeRate: PLATFORM_FEE_RATE,
		counts: { confirmed: 0, pending: 0, failed: 0 },
		amounts: { confirmed: 0, pending: 0, failed: 0 },
		channels: { mpesaStk: { count: 0, amount: 0 }, manual: { count: 0, amount: 0 } },
		grossConfirmed: 0,
		platformFee: 0,
		netPayable: 0
	};
	for (const row of rows) {
		const status = row.status as keyof TreasurerSummary['counts'];
		if (status in summary.counts) {
			summary.counts[status] += 1;
			summary.amounts[status] += row.amount;
		}
		if (row.status !== 'confirmed') continue;
		const channel = donationChannel(row.reference) === 'mpesa-stk' ? 'mpesaStk' : 'manual';
		summary.channels[channel].count += 1;
		summary.channels[channel].amount += row.amount;
		summary.grossConfirmed += row.amount;
		summary.platformFee += donationFee(row.amount);
	}
	summary.netPayable = summary.grossConfirmed - summary.platformFee;
	return summary;
}

function csvField(value: string | number | null): string {
	const s = value === null ? '' : String(value);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Full ledger as CSV. Every status included so the treasurer can chase
 * pendings; fee/net columns only carry values on confirmed rows. */
export function buildTreasurerCsv(rows: DonationRow[]): string {
	const header = ['Date', 'Donor', 'Phone', 'Status', 'Channel', 'Reference', 'Amount (KES)', 'Platform fee (KES)', 'Net (KES)'];
	const lines = rows.map((row) => {
		const confirmed = row.status === 'confirmed';
		const fee = confirmed ? donationFee(row.amount) : null;
		return [
			row.createdAt.toISOString().slice(0, 10),
			row.donorName,
			row.phoneNumber,
			row.status,
			donationChannel(row.reference) === 'mpesa-stk' ? 'M-Pesa STK' : 'Manual',
			row.reference,
			row.amount,
			fee,
			confirmed ? row.amount - fee! : null
		].map(csvField).join(',');
	});
	const summary = buildTreasurerSummary(rows);
	return [
		header.join(','),
		...lines,
		'',
		`Gross confirmed,,,,,,${summary.grossConfirmed},,`,
		`Platform fee (${PLATFORM_FEE_RATE * 100}%),,,,,,,${summary.platformFee},`,
		`Net payable,,,,,,,,${summary.netPayable}`
	].join('\n');
}
