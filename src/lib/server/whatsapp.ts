import { env } from '$env/dynamic/private';

/**
 * Sends a WhatsApp message via the WhatsApp Cloud API (Meta). With
 * WHATSAPP_TOKEN + WHATSAPP_PHONE_ID set it posts to the Graph API; otherwise
 * (dev) it logs to the console so WhatsApp flows stay testable without a provider,
 * mirroring sms.ts. `to` is a bare MSISDN (digits, no '+').
 */
export async function sendWhatsApp(to: string, message: string): Promise<void> {
	const token = env.WHATSAPP_TOKEN;
	const phoneId = env.WHATSAPP_PHONE_ID;

	if (!token || !phoneId) {
		console.log(`\n──── whatsapp (stub) ────\nto: +${to}\n\n${message}\n──────────────────────────\n`);
		return;
	}

	const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			messaging_product: 'whatsapp',
			to,
			type: 'text',
			text: { body: message }
		})
	});

	if (!res.ok) {
		throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
	}
}
