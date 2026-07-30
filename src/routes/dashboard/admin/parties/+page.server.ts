import { fail } from '@sveltejs/kit';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, leaders, parties } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { slugify } from '$lib/server/leader';
import { savePartyLogo } from '$lib/server/storage';
import type { Actions, PageServerLoad } from './$types';

const PARTY_STATUSES = ['full', 'provisional'] as const;

// Reads the editable party fields off a submitted form (shared by create/edit).
function readPartyForm(form: FormData) {
	const name = String(form.get('name') ?? '').trim();
	const status = String(form.get('status') ?? '').trim();
	const certifiedRaw = String(form.get('certifiedAt') ?? '').trim();
	const phone = String(form.get('phone') ?? '').trim();
	const email = String(form.get('email') ?? '').trim();
	return {
		name,
		status,
		values: {
			name,
			abbreviation: String(form.get('abbreviation') ?? '').trim() || null,
			status,
			slogan: String(form.get('slogan') ?? '').trim() || null,
			description: String(form.get('description') ?? '').trim() || null,
			symbol: String(form.get('symbol') ?? '').trim() || null,
			colors: String(form.get('colors') ?? '').trim() || null,
			postal: String(form.get('postal') ?? '').trim() || null,
			hq: String(form.get('hq') ?? '').trim() || null,
			notes: String(form.get('notes') ?? '').trim() || null,
			contacts: { phone: phone || null, email: email || null },
			certifiedAt: certifiedRaw ? new Date(`${certifiedRaw}T00:00:00+03:00`) : null
		}
	};
}

function validateParty(name: string, status: string): string | null {
	if (!name) return 'A party needs a name.';
	if (!PARTY_STATUSES.includes(status as (typeof PARTY_STATUSES)[number])) return 'Pick a registration status (full or provisional).';
	return null;
}

// Admin roster for the parties.verifiedAt badge: confirms the party's ORPP
// listing (name/symbol/colors/status) was manually checked against the
// register. A badge only (see docs/URLDiscovery.md) — never a visibility gate.
export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	const rows = await db.select().from(parties).where(isNull(parties.deletedAt)).orderBy(parties.name);

	// Members: distinct people with a live term or run recording this party
	// (partyId is per-term/per-run, not a person-level fact — see leaders.partyId).
	const [termRows, runRows] = await Promise.all([
		db.select({ partyId: leaders.partyId, userId: leaders.userId }).from(leaders).where(and(isNull(leaders.deletedAt), isNotNull(leaders.partyId))),
		db
			.select({ partyId: campaigns.partyId, userId: campaigns.subjectUserId })
			.from(campaigns)
			.where(and(isNull(campaigns.deletedAt), isNull(campaigns.parentCampaignId), isNotNull(campaigns.partyId)))
	]);
	const membersByPartyId = new Map<number, Set<number>>();
	for (const r of [...termRows, ...runRows]) {
		if (!r.partyId) continue;
		const set = membersByPartyId.get(r.partyId) ?? new Set<number>();
		set.add(r.userId);
		membersByPartyId.set(r.partyId, set);
	}
	const countByPartyId = new Map([...membersByPartyId.entries()].map(([partyId, users]) => [partyId, users.size]));

	return {
		parties: rows.map((p) => ({
			id: p.id,
			slug: slugify(p.name),
			name: p.name,
			abbreviation: p.abbreviation,
			logo: p.logo,
			status: p.status,
			createdAt: p.createdAt.toISOString(),
			certifiedAt: p.certifiedAt ? p.certifiedAt.toISOString() : null,
			verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
			memberCount: countByPartyId.get(p.id) ?? 0,
			// The rest of the editable fields, for the admin edit form to prefill.
			slogan: p.slogan,
			description: p.description,
			symbol: p.symbol,
			colors: p.colors,
			postal: p.postal,
			hq: p.hq,
			notes: p.notes,
			contacts: (p.contacts ?? {}) as { phone?: string | null; email?: string | null },
			certifiedDate: p.certifiedAt ? p.certifiedAt.toISOString().slice(0, 10) : ''
		}))
	};
};

export const actions: Actions = {
	create: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const { name, status, values } = readPartyForm(form);
		const err = validateParty(name, status);
		if (err) return fail(400, { error: err });

		const [row] = await db.insert(parties).values(values).returning({ id: parties.id });

		// Logo rides the same multipart submit; saved under the new party's id.
		const logo = form.get('logo');
		if (logo instanceof File && logo.size > 0) {
			try {
				const url = await savePartyLogo(row.id, logo);
				await db.update(parties).set({ logo: url }).where(eq(parties.id, row.id));
			} catch (e) {
				return fail(400, { error: e instanceof Error ? e.message : 'Logo upload failed.' });
			}
		}
		return { saved: true };
	},

	edit: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('partyId') ?? 0);
		if (!id) return fail(400, { error: 'Party not found.' });
		const { name, status, values } = readPartyForm(form);
		const err = validateParty(name, status);
		if (err) return fail(400, { error: err });

		await db.update(parties).set({ ...values, updatedAt: new Date() }).where(eq(parties.id, id));

		const logo = form.get('logo');
		if (logo instanceof File && logo.size > 0) {
			try {
				const url = await savePartyLogo(id, logo);
				await db.update(parties).set({ logo: url }).where(eq(parties.id, id));
			} catch (e) {
				return fail(400, { error: e instanceof Error ? e.message : 'Logo upload failed.' });
			}
		}
		return { saved: true };
	},

	verify: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('partyId') ?? 0);
		if (!id) return fail(400, { error: 'Party not found.' });
		await db.update(parties).set({ verifiedAt: new Date() }).where(eq(parties.id, id));
		return { saved: true };
	},
	unverify: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('partyId') ?? 0);
		if (!id) return fail(400, { error: 'Party not found.' });
		await db.update(parties).set({ verifiedAt: null }).where(eq(parties.id, id));
		return { saved: true };
	}
};
