// Applies scripts/data/notable-profiles.ts: brings a thin or entirely missing
// profile up to the depth the public page and the profile AI both assume.
//
// Per person it writes, in dependency order:
//   users            bio, dateOfBirth, socials (created outright when absent)
//   leaders          elective terms the scraped register misses
//   experience       education and professional history
//   deliveries       pinned Delivery-tab items, capped at 5 per PERSON
//   faq_entries      Knowledge-tab Q&A, the profile AI's primary grounding
//   knowledge_documents  one career-timeline source document per person
//
// Idempotent throughout: experience matches on (subject, kind, title, institution),
// deliveries on (anchor, title), FAQ on (subject, question), documents on
// (subject, title). Re-running adds only what is missing and backfills dates and
// descriptions that are null.
//
// A profile with a manager or a live claim belongs to a real team, so its bio and
// socials are left alone even when this file has better text. Everything additive
// (experience, deliveries, FAQ, documents) still applies, the same way a second
// seed phase would.
//
// Dry run by default, printing every write it would make; --apply commits.
//   bun run scripts/seed-notable-profiles.ts
//   bun run scripts/seed-notable-profiles.ts --apply
//   bun run scripts/seed-notable-profiles.ts --slug justin-muturi --apply
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
	deliveries,
	experience,
	faqEntries,
	knowledgeDocuments,
	leaders,
	managers,
	parties,
	positions,
	profileClaims,
	users
} from '../src/lib/server/db/schema';
import { user as authUsers } from '../src/lib/server/db/auth.schema';
import { generateLeaderSlug, slugify, splitName, type AnyDb } from './lib/names';
import { NOTABLE_PROFILES, type DeliveryAnchor, type NotableProfile } from './data/notable-profiles';

// Same cap the dashboard's own togglePin action enforces. Counted per PERSON, not
// per term: the public profile shows one Delivered panel for the whole person.
const MAX_PINNED = 5;

const { values: flags } = parseArgs({
	options: {
		apply: { type: 'boolean', default: false },
		slug: { type: 'string' }
	}
});
const APPLY = flags.apply;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

/** "1999-01-01" | null -> a Date | null, in EAT, matching every other seed script. */
function toDate(iso: string | null | undefined): Date | null {
	return iso ? new Date(`${iso}T00:00:00+03:00`) : null;
}

const counts: Record<string, number> = {};
function tally(key: string, n = 1) {
	counts[key] = (counts[key] ?? 0) + n;
}

function say(slug: string, message: string) {
	console.log(`  [${slug}] ${APPLY ? '' : 'would '}${message}`);
}

/** Find-or-create the person. Returns their `users.id` plus whether a real team owns
 * the profile, which decides if the bio and socials may be rewritten. */
async function resolvePerson(slug: string, profile: NotableProfile): Promise<{ id: number; owned: boolean } | null> {
	const [existing] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.slug, slug), isNull(users.deletedAt)));

	if (existing) {
		const [mgr] = await db
			.select({ id: managers.id })
			.from(managers)
			.where(and(eq(managers.subjectUserId, existing.id), eq(managers.isActive, true), isNull(managers.deletedAt)));
		const [claim] = await db
			.select({ id: profileClaims.id })
			.from(profileClaims)
			.where(and(eq(profileClaims.subjectUserId, existing.id), isNull(profileClaims.deletedAt)));
		return { id: existing.id, owned: !!mgr || !!claim };
	}

	// Absent from the register: build the account chain the way scripts/lib/people.ts
	// does, an auth `user` row plus the domain `users` row that carries the slug. No
	// `account` row, so there is no password and nobody can sign in as them, exactly
	// like every other seeded profile awaiting a claim.
	say(slug, `create the person "${profile.name}" (not in the register)`);
	if (!APPLY) return null;

	const email = `${slugify(profile.name)}@seed.leaders.ke`;
	const { firstName, otherNames } = splitName(profile.name);
	const authId = randomUUID();
	const created = await db.transaction(async (tx) => {
		await tx.insert(authUsers).values({ id: authId, name: profile.name, email, emailVerified: false });
		const generated = await generateLeaderSlug(tx as AnyDb, profile.name);
		const [row] = await tx
			.insert(users)
			.values({ authUserId: authId, firstName, otherNames, slug: generated })
			.returning({ id: users.id, slug: users.slug });
		return row;
	});
	if (created.slug !== slug) {
		console.warn(`  [${slug}] WARNING: created with slug "${created.slug}" (a collision suffix was applied)`);
	}
	tally('people created');
	return { id: created.id, owned: false };
}

/** Bio, date of birth and socials. Socials merge rather than replace, so a handle a
 * team already added survives. */
async function applyIdentity(slug: string, userId: number, owned: boolean, profile: NotableProfile) {
	const [row] = await db
		.select({ bio: users.bio, dateOfBirth: users.dateOfBirth, socials: users.socials })
		.from(users)
		.where(eq(users.id, userId));

	const patch: Record<string, unknown> = {};

	if (profile.bio && row.bio !== profile.bio) {
		if (owned) say(slug, 'skip bio (profile has a manager or a live claim)');
		else {
			patch.bio = profile.bio;
			say(slug, `${row.bio ? 'replace' : 'set'} bio (${profile.bio.length} chars)`);
		}
	}

	if (profile.dateOfBirth && !row.dateOfBirth) {
		patch.dateOfBirth = profile.dateOfBirth;
		say(slug, `set date of birth ${profile.dateOfBirth}`);
	}

	if (profile.socials) {
		const merged = { ...profile.socials, ...row.socials };
		const added = Object.keys(merged).filter((k) => !(k in row.socials));
		if (added.length) {
			patch.socials = merged;
			say(slug, `add social ${added.join(', ')}`);
		}
	}

	if (Object.keys(patch).length) {
		tally('identity updates');
		if (APPLY) await db.update(users).set(patch).where(eq(users.id, userId));
	}
}

/** Elective terms the scraped register misses. Never touches a term that already
 * exists for the same person and seat. */
async function applyTerms(slug: string, userId: number, profile: NotableProfile) {
	for (const term of profile.terms ?? []) {
		const [position] = await db
			.select({ id: positions.id })
			.from(positions)
			.where(and(eq(positions.title, term.positionTitle), eq(positions.region, term.region), isNull(positions.deletedAt)));
		if (!position) {
			console.warn(`  [${slug}] no ${term.positionTitle} position for region "${term.region}", skipping term`);
			continue;
		}

		const [existing] = await db
			.select({ id: leaders.id })
			.from(leaders)
			.where(and(eq(leaders.userId, userId), eq(leaders.positionId, position.id), isNull(leaders.deletedAt)));
		if (existing) continue;

		let partyId: number | null = null;
		if (term.party) {
			const [party] = await db.select({ id: parties.id }).from(parties).where(eq(parties.name, term.party));
			partyId = party?.id ?? null;
		}

		say(slug, `add ${term.status} term: ${term.positionTitle}, ${term.region}${term.description ? ` (${term.description})` : ''}`);
		tally('terms');
		if (!APPLY) continue;
		await db.insert(leaders).values({
			userId,
			positionId: position.id,
			status: term.status,
			description: term.description ?? null,
			partyId,
			startAt: toDate(term.startAt)!,
			endAt: toDate(term.endAt),
			verifiedAt: new Date()
		});
	}
}

/** Education and professional history. An existing row is backfilled, never
 * duplicated: a null description or null dates get filled, and a row marked
 * `fixDates` has its dates corrected even when they are already set. */
async function applyExperience(slug: string, userId: number, profile: NotableProfile) {
	for (const row of profile.experience) {
		const [existing] = await db
			.select({ id: experience.id, description: experience.description, startAt: experience.startAt, endAt: experience.endAt })
			.from(experience)
			.where(
				and(
					eq(experience.subjectUserId, userId),
					eq(experience.type, row.kind),
					eq(experience.title, row.title),
					eq(experience.institution, row.institution),
					isNull(experience.deletedAt)
				)
			);

		if (!existing) {
			say(slug, `add ${row.kind}: ${row.title}, ${row.institution}`);
			tally('experience');
			if (APPLY) {
				await db.insert(experience).values({
					subjectUserId: userId,
					type: row.kind,
					title: row.title,
					institution: row.institution,
					description: row.description,
					startAt: toDate(row.startAt),
					endAt: toDate(row.endAt)
				});
			}
			continue;
		}

		// `fixDates` widens the rule from "fill a null" to "correct whatever is
		// there", but either way a value that already matches is left alone, so a
		// re-run reports nothing rather than rewriting the same dates every time.
		const differs = (want: string | null, have: Date | null, allowOverwrite: boolean) =>
			!!want && (allowOverwrite || !have) && toDate(want)!.getTime() !== have?.getTime();

		const patch: Record<string, unknown> = {};
		if (row.description && !existing.description) patch.description = row.description;
		if (differs(row.startAt, existing.startAt, !!row.fixDates)) patch.startAt = toDate(row.startAt);
		if (differs(row.endAt, existing.endAt, !!row.fixDates)) patch.endAt = toDate(row.endAt);
		if (Object.keys(patch).length) {
			say(slug, `backfill ${row.kind} "${row.title}": ${Object.keys(patch).join(', ')}`);
			tally('experience backfills');
			if (APPLY) await db.update(experience).set(patch).where(eq(experience.id, existing.id));
		}
	}
}

/** Resolves a delivery's anchor to the leaders row or experience row it hangs off.
 * Runs after applyTerms and applyExperience, so both are already present. */
async function resolveAnchor(userId: number, anchor: DeliveryAnchor): Promise<{ leaderId: number | null; experienceId: number | null } | null> {
	if (anchor.kind === 'term') {
		const [term] = await db
			.select({ id: leaders.id })
			.from(leaders)
			.innerJoin(positions, eq(leaders.positionId, positions.id))
			.where(
				and(
					eq(leaders.userId, userId),
					eq(positions.title, anchor.positionTitle),
					eq(positions.region, anchor.region),
					isNull(leaders.deletedAt)
				)
			);
		return term ? { leaderId: term.id, experienceId: null } : null;
	}
	const [row] = await db
		.select({ id: experience.id })
		.from(experience)
		.where(
			and(
				eq(experience.subjectUserId, userId),
				eq(experience.title, anchor.title),
				eq(experience.institution, anchor.institution),
				isNull(experience.deletedAt)
			)
		);
	return row ? { leaderId: null, experienceId: row.id } : null;
}

/** Delivery-tab items, pinned so they surface on the public profile immediately.
 * Respects the 5-pinned cap across the whole person; anything past it is still
 * inserted, just unpinned, exactly as the dashboard behaves. */
async function applyDeliveries(slug: string, userId: number, profile: NotableProfile) {
	// Every delivery this person already has, reached through both parents: a
	// delivery hangs off either a leaders term or an experience row, never both, so
	// the two sets are collected separately and unioned.
	const ownLeaderIds = (
		await db.select({ id: leaders.id }).from(leaders).where(and(eq(leaders.userId, userId), isNull(leaders.deletedAt)))
	).map((r) => r.id);
	const ownExperienceIds = (
		await db.select({ id: experience.id }).from(experience).where(and(eq(experience.subjectUserId, userId), isNull(experience.deletedAt)))
	).map((r) => r.id);

	const columns = { title: deliveries.title, pinnedAt: deliveries.pinnedAt };
	const [byTerm, byRole] = await Promise.all([
		ownLeaderIds.length
			? db.select(columns).from(deliveries).where(and(inArray(deliveries.leaderId, ownLeaderIds), isNull(deliveries.deletedAt)))
			: [],
		ownExperienceIds.length
			? db.select(columns).from(deliveries).where(and(inArray(deliveries.experienceId, ownExperienceIds), isNull(deliveries.deletedAt)))
			: []
	]);
	const mine = [...byTerm, ...byRole];
	let pinnedCount = mine.filter((r) => r.pinnedAt).length;
	const existingTitles = new Set(mine.map((r) => r.title));

	for (const item of profile.deliveries) {
		if (existingTitles.has(item.title)) continue;
		const anchor = await resolveAnchor(userId, item.anchor);
		if (!anchor) {
			const label = item.anchor.kind === 'term' ? `${item.anchor.positionTitle}, ${item.anchor.region}` : `${item.anchor.title}, ${item.anchor.institution}`;
			console.warn(`  [${slug}] no anchor "${label}" for delivery "${item.title}", skipping`);
			continue;
		}
		const canPin = pinnedCount < MAX_PINNED;
		say(slug, `add delivery${canPin ? ' (pinned)' : ' (unpinned, cap reached)'}: ${item.title}`);
		tally('deliveries');
		if (APPLY) {
			await db.insert(deliveries).values({
				leaderId: anchor.leaderId,
				experienceId: anchor.experienceId,
				title: item.title,
				description: item.description,
				pinnedAt: canPin ? new Date() : null
			});
		}
		if (canPin) pinnedCount++;
	}
}

/** Knowledge-tab FAQ, the profile AI's primary grounding. */
async function applyFaqs(slug: string, userId: number, profile: NotableProfile) {
	const existing = await db
		.select({ question: faqEntries.question })
		.from(faqEntries)
		.where(and(eq(faqEntries.subjectUserId, userId), isNull(faqEntries.deletedAt)));
	const seen = new Set(existing.map((f) => f.question));
	const fresh = profile.faqs.filter((f) => !seen.has(f.question));
	if (!fresh.length) return;

	say(slug, `add ${fresh.length} FAQ entr${fresh.length === 1 ? 'y' : 'ies'}`);
	tally('faqs', fresh.length);
	if (!APPLY) return;
	await db.insert(faqEntries).values(
		fresh.map((f, i) => ({ subjectUserId: userId, question: f.question, answer: f.answer, sortOrder: existing.length + i }))
	);
}

/** One career-timeline source document per person, written to the same local
 * storage path the Knowledge tab's own uploads use. `extractedText` is what the AI
 * actually reads. */
async function applyDocuments(slug: string, userId: number, profile: NotableProfile) {
	const existing = await db
		.select({ title: knowledgeDocuments.title })
		.from(knowledgeDocuments)
		.where(and(eq(knowledgeDocuments.subjectUserId, userId), isNull(knowledgeDocuments.deletedAt)));
	const seen = new Set(existing.map((d) => d.title));
	const fresh = profile.documents.filter((d) => !seen.has(d.title));
	if (!fresh.length) return;

	for (const doc of fresh) {
		say(slug, `add document "${doc.title}" (${doc.content.length} chars)`);
		tally('documents');
		if (!APPLY) continue;
		const localDir = process.env.STORAGE_LOCAL_DIR || '.uploads';
		const dir = path.join(process.cwd(), localDir, 'knowledge', String(userId));
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, doc.filename), doc.content, 'utf-8');
		await db.insert(knowledgeDocuments).values({
			subjectUserId: userId,
			title: doc.title,
			fileUrl: `/uploads/knowledge/${userId}/${doc.filename}`,
			mimeType: 'text/plain',
			extractedText: doc.content
		});
	}
}

const targets = Object.entries(NOTABLE_PROFILES).filter(([slug]) => !flags.slug || slug === flags.slug);
if (!targets.length) throw new Error(`no profile matches --slug ${flags.slug}`);

console.log(`\n[notable-profiles] ${APPLY ? 'APPLYING' : 'DRY RUN'}, ${targets.length} profile(s)\n`);

for (const [slug, profile] of targets) {
	console.log(`${slug}`);
	const person = await resolvePerson(slug, profile);
	if (!person) {
		console.log(`  [${slug}] (dry run: the rest of this profile depends on the new row, re-run with --apply to see it)\n`);
		continue;
	}
	await applyIdentity(slug, person.id, person.owned, profile);
	await applyTerms(slug, person.id, profile);
	await applyExperience(slug, person.id, profile);
	await applyDeliveries(slug, person.id, profile);
	await applyFaqs(slug, person.id, profile);
	await applyDocuments(slug, person.id, profile);
	console.log('');
}

const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to do';
console.log(`[notable-profiles] ${APPLY ? 'applied' : 'would apply'}: ${summary}\n`);

await client.end();
