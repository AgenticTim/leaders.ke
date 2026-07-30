// One-click opt-out landing (TODO #5.3): the link every broadcast carries. The
// token is a stable per-follow secret (followers.unsubscribeToken); hitting this
// route stamps optedOutAt, which the broadcast recipient query excludes — so no
// more manual "Reply STOP". Idempotent: an already-opted-out token just re-shows
// the confirmation. The follow row itself stays (audit + dedupe), it only stops
// receiving. GET-based on purpose: email/SMS clients can't POST a link.
import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { followers, users } from '$lib/server/db/schema';
import { fullName } from '$lib/server/leader';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const token = event.params.token;
	const [row] = await db
		.select({ f: followers, subject: users })
		.from(followers)
		.leftJoin(users, eq(followers.digestId, users.id))
		.where(and(eq(followers.unsubscribeToken, token), isNull(followers.deletedAt)));
	if (!row) error(404, 'This opt-out link is not valid.');

	if (!row.f.optedOutAt) {
		await db
			.update(followers)
			.set({ optedOutAt: new Date(), email: false, sms: false, whatsapp: false, updatedAt: new Date() })
			.where(eq(followers.id, row.f.id));
	}

	return { leaderName: row.subject ? fullName(row.subject) : 'this campaign' };
};
