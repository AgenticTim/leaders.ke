// The Contacts section embedded on the Profile tab (contacts belong to the person,
// so they save alongside the profile) — writes the person's real contacts (the
// phantom users row) directly.
import { fail, type RequestEvent } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contacts, users } from '$lib/server/db/schema';
import { getRouteLeaderContext, ownVerifiedContacts, requireDashboardUser } from '$lib/server/dashboard';
import { PLATFORMS } from '$lib/components/contact/socials';
import { normalizeKenyanPhone } from '$lib/utils/phone';

/** The client stages each social entry as a bare handle (ContactsTab.svelte's
 * handleSocialInput strips a pasted full URL down to one) — reconstruct the full
 * URL here so ContactLinks.svelte (which uses the stored value as an href
 * directly, no prefix logic of its own) actually links somewhere real. */
function buildSocialsRecord(entries: { kind: string; value: string }[], website: string): Record<string, string> {
	const socials: Record<string, string> = {};
	for (const s of entries) {
		const value = s.value?.trim();
		if (!value) continue;
		const platform = PLATFORMS.find((p) => p.kind === s.kind);
		socials[s.kind] = platform ? `https://${platform.prefix}${value}` : value;
	}
	if (website) socials.website = /^https?:\/\//i.test(website) ? website : `https://${website}`;
	return socials;
}

// The subject is the leader profile being edited — a distinct (phantom) user from
// the signed-in account, so this is the campaign's PUBLIC contact info, not the
// citizen's own login identity.
async function getSubject(event: RequestEvent) {
	const { domainUser } = await requireDashboardUser(event);
	const ctx = await getRouteLeaderContext(event, domainUser.id);
	return { subject: ctx?.profileUser ?? domainUser, domainUser };
}

export async function loadContactsTab(event: RequestEvent) {
	const { subject, domainUser } = await getSubject(event);

	const contactRows = await db
		.select({ channel: contacts.channel, value: contacts.value, verifiedAt: contacts.verifiedAt })
		.from(contacts)
		.where(and(eq(contacts.userId, subject.id), isNull(contacts.deletedAt)));

	const email = contactRows.find((c) => c.channel === 'email');
	const sms = contactRows.find((c) => c.channel === 'sms');
	const whatsapp = contactRows.find((c) => c.channel === 'whatsapp');
	const socials = (subject.socials ?? {}) as Record<string, string>;
	const { website, ...otherSocials } = socials;

	// Contacts the editor already OTP-verified on their own citizen account count
	// as verified here too — typing one shows "✓ Verified" without another OTP.
	const own = await ownVerifiedContacts(domainUser.id);

	return {
		address: subject.address ?? '',
		sms: sms?.value ?? '',
		whatsapp: whatsapp?.value ?? '',
		email: email?.value ?? '',
		smsVerified: !!sms?.verifiedAt || own.check('sms', sms?.value ?? ''),
		whatsappVerified: !!whatsapp?.verifiedAt || own.check('whatsapp', whatsapp?.value ?? ''),
		emailVerified: !!email?.verifiedAt || own.check('email', email?.value ?? ''),
		ownVerified: own.lists,
		website: website ?? '',
		socials: otherSocials
	};
}

export async function saveContactsTab(event: RequestEvent) {
	const { subject, domainUser } = await getSubject(event);

	// The editor's own proven contacts: saving one of these onto the profile
	// carries the verification over instead of demanding a second OTP.
	const own = await ownVerifiedContacts(domainUser.id);

	const form = await event.request.formData();
	const address = String(form.get('address') ?? '').trim();
	const sms = String(form.get('sms') ?? '').trim();
	const website = String(form.get('website') ?? '').trim();

	let socialEntries: { kind: string; value: string }[] = [];
	try {
		socialEntries = JSON.parse(String(form.get('socialEntries') ?? '[]'));
	} catch {
		return fail(400, { error: 'Could not read the social links.' });
	}

	const socials = buildSocialsRecord(socialEntries, website);

	await db.update(users).set({ address: address || null, socials }).where(eq(users.id, subject.id));

	// A campaign's public contact lines (the leader profile, not a login) — saved
	// directly on change. Only a value some OTHER person has verified is rejected;
	// the editor's own accounts (citizen login and managed profiles) share one pool
	// of contacts, and a stranger's unverified hold no longer collides now that the
	// unique index is per-user. A value the editor already OTP-verified anywhere is
	// stored verified here too.
	const verifiedChannels: ('sms' | 'whatsapp' | 'email')[] = [];
	const replaceContact = async (channel: 'sms' | 'whatsapp' | 'email', value: string, label: string) => {
		const [existingContact] = await db
			.select({ id: contacts.id, value: contacts.value })
			.from(contacts)
			.where(and(eq(contacts.userId, subject.id), eq(contacts.channel, channel), isNull(contacts.deletedAt)));
		if (existingContact?.value === value) return null;

		if (value) {
			const holders = await db
				.select({ userId: contacts.userId, verifiedAt: contacts.verifiedAt })
				.from(contacts)
				.where(and(eq(contacts.channel, channel), eq(contacts.value, value), isNull(contacts.deletedAt)));
			if (holders.some((h) => h.verifiedAt && h.userId !== subject.id && h.userId !== domainUser.id)) {
				return `That ${label} is already verified on another account.`;
			}
		}

		if (existingContact) {
			await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, existingContact.id));
		}
		if (value) {
			const ownVerified = own.check(channel, value);
			if (ownVerified) verifiedChannels.push(channel);
			await db
				.insert(contacts)
				.values({ userId: subject.id, channel, value, isPrimary: true, verifiedAt: ownVerified ? new Date() : null })
				.onConflictDoNothing();
		}
		return null;
	};

	for (const channel of ['sms', 'whatsapp'] as const) {
		const raw = String(form.get(channel) ?? '').trim();
		// PhoneInput submits the local part (712345678); store the canonical 254… form.
		const value = raw ? (normalizeKenyanPhone(raw) ?? '') : '';
		if (raw && !value) return fail(400, { error: `Enter a valid Kenyan ${channel === 'sms' ? 'SMS' : 'WhatsApp'} number.` });
		const conflict = await replaceContact(channel, value, `${channel === 'sms' ? 'SMS' : 'WhatsApp'} number`);
		if (conflict) return fail(400, { error: conflict });
	}

	// The public contact email — like the phone lines, saved directly and left
	// UNVERIFIED (verifiedAt null); verifying via /verify/email is optional. An
	// unchanged value is skipped so an already-verified email keeps its verifiedAt.
	const email = String(form.get('email') ?? '').trim().toLowerCase();
	if (email && !email.includes('@')) return fail(400, { error: 'Enter a valid email address.' });
	const emailConflict = await replaceContact('email', email, 'email address');
	if (emailConflict) return fail(400, { error: emailConflict });

	// Keep the subject's denormalized users.verified cache in step with any
	// verification carried over from the editor's own contacts above.
	if (verifiedChannels.length) {
		const flags = { ...subject.verified };
		for (const channel of verifiedChannels) flags[channel] = true;
		await db.update(users).set({ verified: flags }).where(eq(users.id, subject.id));
	}

	return { saved: true };
}
