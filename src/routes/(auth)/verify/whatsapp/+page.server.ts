import { fail } from '@sveltejs/kit';
import { redirectWithFlash } from '$lib/server/flash';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contacts, users } from '$lib/server/db/schema';
import { parseScope, resolveVerifySubject, type DashboardUser } from '$lib/server/dashboard';
import { formatKenyanPhoneDisplay, normalizeKenyanPhone } from '$lib/utils/phone';
import { hasPendingOtp, otpCooldownRemaining, sendOtp, verifyOtpWithDestination } from '$lib/server/otp';
import { getPlatformSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

// Only ever redirect to a same-origin relative path — never follow ?next anywhere else.
function safeNext(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

/** A hold only blocks when it is *verified* AND belongs to neither the subject
 * nor the editor - the editor's own citizen contacts are theirs to reuse on any
 * profile they manage. */
async function verifiedByOther(ownerIds: number[], number: string): Promise<boolean> {
	// All holders, not limit(1): the same value may legitimately be live on several
	// of the editor's own accounts, and any one foreign verified row must block.
	const held = await db
		.select({ userId: contacts.userId, verifiedAt: contacts.verifiedAt })
		.from(contacts)
		.where(and(eq(contacts.channel, 'whatsapp'), eq(contacts.value, number), isNull(contacts.deletedAt)));
	return held.some((h) => !ownerIds.includes(h.userId) && h.verifiedAt);
}

/** Same number already OTP-verified as this account's SMS contact — no need to
 * prove control of it twice. */
async function verifiedAsOwnSms(userId: number, number: string): Promise<boolean> {
	const [row] = await db
		.select({ verifiedAt: contacts.verifiedAt })
		.from(contacts)
		.where(and(eq(contacts.userId, userId), eq(contacts.channel, 'sms'), eq(contacts.value, number), isNull(contacts.deletedAt)))
		.limit(1);
	return !!row?.verifiedAt;
}

// Unlike sms/email (one live value per account), a person can keep several WhatsApp
// numbers — so this only adds/verifies the given number, never removes the others.
async function applyNumberVerified(subject: DashboardUser['domainUser'], number: string) {
	// Drop only the subject's own row for this exact value (a re-verify) so the
	// per-user (user, channel, value) unique index can't collide. Other accounts'
	// rows are left alone: the same person's citizen account and profiles may share
	// a value, and a stranger's verified hold was already rejected by verifiedByOther.
	await db
		.update(contacts)
		.set({ deletedAt: new Date() })
		.where(and(eq(contacts.userId, subject.id), eq(contacts.channel, 'whatsapp'), eq(contacts.value, number), isNull(contacts.deletedAt)));
	await db.insert(contacts).values({ userId: subject.id, channel: 'whatsapp', value: number, verifiedAt: new Date() });
	// `verified.whatsapp` means "at least one WhatsApp number is verified".
	await db.update(users).set({ verified: { ...subject.verified, whatsapp: true } }).where(eq(users.id, subject.id));
}

export const load: PageServerLoad = async (event) => {
	const scope = parseScope(event.url.searchParams.get('scope'));
	const slug = event.url.searchParams.get('slug');
	const { domainUser, subject } = await resolveVerifySubject(event, scope, slug);
	const next = safeNext(event.url.searchParams.get('next'));

	const raw = event.url.searchParams.get('number');
	const number = raw ? normalizeKenyanPhone(raw) : null;
	if (!number) redirectWithFlash(event.cookies, next, 'Enter a WhatsApp number to verify.');

	const [existing] = await db
		.select({ verifiedAt: contacts.verifiedAt })
		.from(contacts)
		.where(and(eq(contacts.userId, subject.id), eq(contacts.channel, 'whatsapp'), eq(contacts.value, number), isNull(contacts.deletedAt)));
	if (existing?.verifiedAt) redirectWithFlash(event.cookies, next, `${formatKenyanPhoneDisplay(number)} is already verified.`);
	if (await verifiedByOther([subject.id, domainUser.id], number)) {
		redirectWithFlash(event.cookies, next, `${formatKenyanPhoneDisplay(number)} is already verified on another account.`);
	}
	if (await verifiedAsOwnSms(subject.id, number)) {
		await applyNumberVerified(subject, number);
		redirectWithFlash(event.cookies, next, `${formatKenyanPhoneDisplay(number)} is already verified as your SMS number.`);
	}

	// Auto-send a code on arrival only if none is already outstanding for this
	// number — so a page refresh reuses the code already sent instead of firing a
	// new one. A later resend is a deliberate button click.
	let phoneCooldown = await otpCooldownRemaining('whatsapp', number);
	if (!(await hasPendingOtp('whatsapp', number))) {
		try {
			await sendOtp(subject.id, 'whatsapp', number);
			phoneCooldown = (await getPlatformSettings()).otpCooldownSeconds;
		} catch {
			// Best-effort — the "Resend code" button still lets them retry manually.
		}
	}

	return { next, scope, slug, phone: number, phoneCooldown };
};

export const actions: Actions = {
	sendPhoneCode: async (event) => {
		const form = await event.request.formData();
		const scope = parseScope(String(form.get('scope') ?? ''));
		const { domainUser, subject } = await resolveVerifySubject(event, scope, String(form.get('slug') ?? '') || null);
		const normalized = normalizeKenyanPhone(String(form.get('phone') ?? ''));
		if (!normalized) return fail(400, { phoneError: 'Enter a valid Kenyan phone number.' });
		if (await verifiedByOther([subject.id, domainUser.id], normalized)) {
			return fail(400, { phoneError: `${formatKenyanPhoneDisplay(normalized)} is already verified on another account.` });
		}
		if (await verifiedAsOwnSms(subject.id, normalized)) {
			await applyNumberVerified(subject, normalized);
			return { phoneSent: true, alreadyVerified: true };
		}
		// auto=1 marks the on-mount send a modal-hosted form fires (its host page
		// never runs this route's load, which is what sends on arrival): reuse a
		// still-pending code instead of firing a duplicate on every modal open.
		if (String(form.get('auto') ?? '') === '1' && (await hasPendingOtp('whatsapp', normalized))) {
			return { phoneSent: true, cooldown: await otpCooldownRemaining('whatsapp', normalized) };
		}
		try {
			// Stub: no WhatsApp Business API yet — reuses the same gateway/console stub
			// as SMS (see sendOtp -> sendSms).
			await sendOtp(subject.id, 'whatsapp', normalized);
		} catch (error) {
			return fail(400, { phoneError: error instanceof Error ? error.message : 'Could not send code' });
		}
		return { phoneSent: true, cooldown: (await getPlatformSettings()).otpCooldownSeconds };
	},

	verifyCode: async (event) => {
		const form = await event.request.formData();
		const scope = parseScope(String(form.get('scope') ?? ''));
		const slug = String(form.get('slug') ?? '') || null;
		const { subject } = await resolveVerifySubject(event, scope, slug);
		const code = String(form.get('code') ?? '').trim();
		const next = safeNext(String(form.get('next') ?? '/dashboard/account'));
		if (!code) return fail(400, { codeError: 'Enter the code you received.' });

		const result = await verifyOtpWithDestination(subject.id, 'whatsapp', code);
		if (!result.ok || !result.destination) return fail(400, { codeError: 'That code is invalid or expired.' });

		await applyNumberVerified(subject, result.destination);
		redirectWithFlash(event.cookies, next, `You have successfully verified ${result.destination}`);
	}
};
