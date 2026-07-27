// Account-less candidate follows written to the `followers` table, mirroring
// the campaign page's ?/follow action (same validation, same app-layer dedupe,
// same digest shape) so rows are indistinguishable regardless of entry point.
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, followers } from '$lib/server/db/schema';

export type FollowInput = {
	name: string;
	contact: string;
	county?: string;
	ward?: string;
	/** The followed person's users.id — or resolve it from candidateId below. */
	subjectUserId?: number;
	/** A ballot candidateId ("campaign:<id>"); resolved to the campaign's subject person. */
	candidateId?: string;
};

export async function followLeader(input: FollowInput): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
	const name = input.name.trim();
	const contact = input.contact.trim();
	if (!name || !contact) return { ok: false, error: 'Your name and a phone or email are required.' };

	// Resolve the person behind a ballot pick when only the campaign id was posted.
	let subjectUserId = input.subjectUserId ?? null;
	if (!subjectUserId && input.candidateId?.startsWith('campaign:')) {
		const campaignId = Number(input.candidateId.slice('campaign:'.length));
		if (Number.isInteger(campaignId)) {
			const [row] = await db
				.select({ subjectUserId: campaigns.subjectUserId })
				.from(campaigns)
				.where(and(eq(campaigns.id, campaignId), isNull(campaigns.deletedAt)));
			subjectUserId = row?.subjectUserId ?? null;
		}
	}
	if (!subjectUserId) return { ok: false, error: 'Candidate not found.' };

	const isEmail = contact.includes('@');
	const emailAddress = isEmail ? contact.toLowerCase() : null;
	const phoneNumber = isEmail ? null : contact.replace(/[^\d+]/g, '');
	if (!isEmail && (phoneNumber?.length ?? 0) < 9) {
		return { ok: false, error: 'Enter a valid phone number or email address.' };
	}

	// App-layer dedupe for account-less follows: one live follow per contact per leader.
	const duplicate = await db
		.select({ id: followers.id })
		.from(followers)
		.where(
			and(
				eq(followers.digest, 'leader'),
				eq(followers.digestId, subjectUserId),
				isNull(followers.deletedAt),
				or(
					emailAddress ? eq(followers.emailAddress, emailAddress) : undefined,
					phoneNumber ? eq(followers.phoneNumber, phoneNumber) : undefined
				)
			)
		)
		.limit(1);
	if (duplicate.length > 0) {
		return { ok: false, error: 'You already follow this candidate with that contact.' };
	}

	await db.insert(followers).values({
		name,
		emailAddress,
		phoneNumber,
		county: input.county?.trim() || null,
		ward: input.ward?.trim() || null,
		digest: 'leader',
		digestId: subjectUserId,
		// Contact channel doubles as the digest opt-in; SMS numbers get WhatsApp later, not assumed.
		email: isEmail,
		sms: !isEmail
	});

	return { ok: true, name };
}
