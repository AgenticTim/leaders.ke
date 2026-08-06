// Verifies Africa's Talking credentials end to end without going through a
// signup flow: same request shape, same status-code checks, and the same phone
// normalisation the app uses, so a pass here means OTP delivery works.
//
// Usage: bun run scripts/send-test-sms.ts 0712345678 ["custom message"]
//
// Mirrors $lib/server/sms.ts rather than importing it (that file reads
// $env/dynamic/private, which only resolves inside SvelteKit's runtime). Keep
// the two in step if the send logic changes.
import { normalizeKenyanPhone } from '../src/lib/utils/phone';

const ACCEPTED_STATUS_CODES = new Set([100, 101, 102]);

type ATRecipient = { number: string; status: string; statusCode: number; cost?: string };

const [rawPhone, customMessage] = process.argv.slice(2);
if (!rawPhone) {
	console.error('Usage: bun run scripts/send-test-sms.ts <phone> ["message"]');
	process.exit(1);
}

const to = normalizeKenyanPhone(rawPhone);
if (!to) {
	console.error(`"${rawPhone}" is not a valid Kenyan mobile number.`);
	process.exit(1);
}

const username = process.env.AFRICASTALKING_USERNAME;
const apiKey = process.env.AFRICASTALKING_API_KEY;
const senderId = process.env.AFRICASTALKING_SENDER_ID;
if (!username || !apiKey) {
	console.error('AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY must both be set.');
	process.exit(1);
}

const sandbox = username === 'sandbox';
const host = sandbox ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
const message = customMessage ?? 'vote.ke test message. If you received this, SMS delivery works.';

console.log(`account : ${username}${sandbox ? ' (sandbox)' : ''}`);
console.log(`sender  : ${senderId || '(shared pool)'}`);
console.log(`to      : +${to}\n`);

const body = new URLSearchParams({ username, to: `+${to}`, message });
if (senderId) body.set('from', senderId);

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
	console.error(`FAILED (HTTP ${res.status}): ${text}`);
	process.exit(1);
}

const recipients: ATRecipient[] = JSON.parse(text)?.SMSMessageData?.Recipients ?? [];
if (recipients.length === 0) {
	console.error(`FAILED, nothing queued: ${text}`);
	process.exit(1);
}
for (const r of recipients) {
	const ok = ACCEPTED_STATUS_CODES.has(r.statusCode);
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.number} ${r.status} (${r.statusCode})${r.cost ? ` cost ${r.cost}` : ''}`);
}
process.exit(recipients.every((r) => ACCEPTED_STATUS_CODES.has(r.statusCode)) ? 0 : 1);
