// Paystack integration for subscription checkout: redirect-based charge
// (initialize -> customer pays on Paystack's page -> callback verify) plus the
// signed webhook that makes fulfillment reliable even when the customer never
// returns to the callback URL. Amounts are KES; Paystack wants subunits (x100).
// With no PAYSTACK_SECRET_KEY set (local dev), checkout falls back to the mock
// instant-success charge, see the checkout action.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const API_BASE = 'https://api.paystack.co';

// Only a real SECRET key (sk_...) can authorize server-side charges. A blank
// value or a public key (pk_...) pasted into the slot would sail past a bare
// truthy check and then fail every charge with Paystack's abstract "Invalid
// key", so require the sk_ prefix and otherwise fall back to the mock path.
export function paystackEnabled(): boolean {
	return !!env.PAYSTACK_SECRET_KEY?.startsWith('sk_');
}

type InitializeInput = {
	email: string;
	amountKes: number;
	reference: string;
	callbackUrl: string;
};

type PaystackVerification = {
	status: 'success' | 'failed' | 'abandoned' | string;
	amountKes: number;
	channel: string | null; // 'mobile_money' | 'card' | 'bank' | ...
	paidAt: Date | null;
};

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
			'Content-Type': 'application/json',
			...init?.headers
		}
	});
	const body = (await res.json()) as {
		status: boolean;
		message?: string;
		data?: Record<string, unknown>;
	};
	if (!res.ok || !body.status) {
		throw new Error(body.message || `Paystack request failed (${res.status})`);
	}
	return body.data ?? {};
}

/** Starts a hosted-page charge; the customer pays at the returned URL. */
export async function initializeTransaction(
	input: InitializeInput
): Promise<{ authorizationUrl: string }> {
	const data = await api('/transaction/initialize', {
		method: 'POST',
		body: JSON.stringify({
			email: input.email,
			amount: Math.round(input.amountKes * 100),
			currency: 'KES',
			reference: input.reference,
			callback_url: input.callbackUrl
		})
	});
	return { authorizationUrl: String(data.authorization_url) };
}

/** Direct mobile-money charge: fires a real M-Pesa STK push to the phone. No
 * hosted page, no redirect. Paystack answers 'pay_offline' (prompt sent, the
 * donor approves on their handset) or 'success' (rare instant settle); either
 * way the signed webhook's charge.success is what confirms the money. */
export async function chargeMobileMoney(input: {
	email: string;
	amountKes: number;
	phone: string;
	reference: string;
}): Promise<{ status: string }> {
	const data = await api('/charge', {
		method: 'POST',
		body: JSON.stringify({
			email: input.email,
			amount: Math.round(input.amountKes * 100),
			currency: 'KES',
			reference: input.reference,
			mobile_money: { phone: input.phone, provider: 'mpesa' }
		})
	});
	return { status: String(data.status ?? '') };
}

/** M-Pesa numbers must be international format: 07XX/01XX locals become +254. */
export function normalizeMpesaPhone(raw: string): string | null {
	const digits = raw.replace(/[^\d+]/g, '');
	if (/^\+254[17]\d{8}$/.test(digits)) return digits;
	if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
	if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
	return null;
}

/** Server-side truth about a charge, never trust the callback query alone. */
export async function verifyTransaction(reference: string): Promise<PaystackVerification> {
	const data = await api(`/transaction/verify/${encodeURIComponent(reference)}`);
	return {
		status: String(data.status),
		amountKes: Number(data.amount) / 100,
		channel: data.channel ? String(data.channel) : null,
		paidAt: data.paid_at ? new Date(String(data.paid_at)) : null
	};
}

/** Webhook authenticity: x-paystack-signature is HMAC-SHA512 of the raw body. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
	if (!signature || !env.PAYSTACK_SECRET_KEY) return false;
	const expected = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
	const a = Buffer.from(expected);
	const b = Buffer.from(signature);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Maps Paystack's channel to the payments.method vocabulary ('mpesa' | 'card' | 'bank'). */
export function methodFromChannel(channel: string | null): string {
	if (channel === 'mobile_money') return 'mpesa';
	if (channel === 'card') return 'card';
	return channel || 'bank';
}
