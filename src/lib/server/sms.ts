import { env } from '$env/dynamic/private';

/** Africa's Talking status codes that mean the message was accepted for
 * delivery: 100 Processed, 101 Sent, 102 Queued. Anything else (a bad number,
 * an empty account, a sender ID that isn't approved) is a failure the API still
 * reports inside a 201 response, so the body has to be read, not just the
 * status line. This matters most for OTP: a silently dropped code leaves
 * someone staring at a form waiting for an SMS that will never arrive. */
const ACCEPTED_STATUS_CODES = new Set([100, 101, 102]);

type ATRecipient = { number: string; status: string; statusCode: number };
type ATResponse = { SMSMessageData?: { Message?: string; Recipients?: ATRecipient[] } };

/**
 * Sends an SMS via Africa's Talking. With AFRICASTALKING_API_KEY set it posts to
 * their REST API; otherwise (dev) it logs the message to the console so SMS flows
 * stay testable without a provider, copy the code from the terminal.
 *
 * `to` is a bare international number without the plus (254712345678, the form
 * normalizeKenyanPhone returns and the one stored on contacts).
 *
 * Set AFRICASTALKING_USERNAME to "sandbox" to exercise the free sandbox: the
 * host differs from production, so it's derived from the username rather than
 * being a separate setting to keep in sync.
 */
export async function sendSms(to: string, message: string): Promise<void> {
	const apiKey = env.AFRICASTALKING_API_KEY;
	const username = env.AFRICASTALKING_USERNAME;

	if (!apiKey || !username) {
		console.log(`\n──── sms (stub) ────\nto: +${to}\n\n${message}\n─────────────────────\n`);
		return;
	}

	const host = username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
	const body = new URLSearchParams({ username, to: `+${to}`, message });
	// A registered alphanumeric sender ID or short code. Kenya requires these to
	// be approved before use, so it stays optional: without it the message goes
	// out on Africa's Talking' shared pool.
	if (env.AFRICASTALKING_SENDER_ID) body.set('from', env.AFRICASTALKING_SENDER_ID);

	const res = await fetch(`https://${host}/version1/messaging`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
			apiKey
		},
		body
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Africa's Talking send failed (${res.status}): ${text}`);
	}

	// Accepted at the HTTP level, but each recipient carries its own verdict.
	let parsed: ATResponse | null = null;
	try {
		parsed = JSON.parse(text) as ATResponse;
	} catch {
		throw new Error(`Africa's Talking returned an unreadable response: ${text}`);
	}
	const recipients = parsed.SMSMessageData?.Recipients ?? [];
	if (recipients.length === 0) {
		// No recipient row at all means nothing was queued, and the summary line
		// says why (e.g. "InvalidPhoneNumber", "Sent to 0/1 Total Cost 0").
		throw new Error(`Africa's Talking queued nothing: ${parsed.SMSMessageData?.Message ?? text}`);
	}
	const failed = recipients.filter((r) => !ACCEPTED_STATUS_CODES.has(r.statusCode));
	if (failed.length > 0) {
		throw new Error(
			`Africa's Talking rejected ${failed.length}/${recipients.length}: ${failed
				.map((r) => `${r.number} ${r.status} (${r.statusCode})`)
				.join(', ')}`
		);
	}
}
