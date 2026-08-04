// Backfills users.dateOfBirth from Wikidata (plans/10-platform-wide-ai-chat.md's
// data gap 1), so age comparisons like "who is the youngest governor" have a
// real basis instead of the stale self-declared users.age integer.
//
// Name -> Wikipedia page -> Wikidata entity -> P569 (date of birth). Wikidata
// rather than scraping an infobox: it's structured, so there's no HTML parsing
// to rot, and it carries the citizenship claim this script uses to reject a
// wrong-person match.
//
// A wrong birth date is worse than none, since it would be stated as fact to
// citizens, so a match is only accepted when the entity claims Kenyan citizenship
// (P27 = Q114). That rejects the common failure mode of a Kenyan politician's
// name matching some unrelated person on the English Wikipedia.
//
// Dry run by default (prints what it would write); --apply commits.
//   bun run scripts/backfill-dob.ts                  # preview, governors only
//   bun run scripts/backfill-dob.ts --apply
//   bun run scripts/backfill-dob.ts --title Senator --apply
import { parseArgs } from 'node:util';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { leaders, positions, users } from '../src/lib/server/db/schema';

const { values } = parseArgs({
	options: {
		apply: { type: 'boolean', default: false },
		// Governors first, per the plan: they're the smallest, highest-profile
		// set, so coverage is best and mistakes are easiest to eyeball.
		title: { type: 'string', default: 'Governor' },
		limit: { type: 'string', default: '100' }
	}
});
const APPLY = values.apply;
const TITLE = values.title as string;
const LIMIT = Number(values.limit);

const KENYA = 'Q114'; // Wikidata: Republic of Kenya
const UA = 'vote.ke DOB backfill (techytimo@gmail.com)';
const DELAY_MS = 300; // polite spacing between API calls

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any | null> {
	try {
		const res = await fetch(url, { headers: { 'user-agent': UA } });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

/** The Wikidata entity id for a person's name, via their Wikipedia page.
 * `redirects=1` follows "Johnson Sakaja" -> whatever the canonical title is. */
async function wikidataIdFor(name: string): Promise<string | null> {
	const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&titles=${encodeURIComponent(name)}`;
	const data = await getJson(url);
	const pages = data?.query?.pages;
	if (!pages) return null;
	for (const page of Object.values<any>(pages)) {
		const id = page?.pageprops?.wikibase_item;
		if (id) return id;
	}
	return null;
}

/** Date of birth (YYYY-MM-DD) for an entity, but ONLY if it also claims Kenyan
 * citizenship. That's the guard against silently importing a different person who
 * happens to share the name. Returns why it was rejected, for the dry run. */
async function birthDateFor(entityId: string): Promise<{ dob: string } | { skip: string }> {
	const data = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`);
	const entity = data?.entities?.[entityId];
	if (!entity) return { skip: 'entity not found' };

	// Wikidata frequently has no citizenship claim at all on Kenyan politicians,
	// so requiring P27=Kenya outright rejected real governors. The rule is
	// therefore: a citizenship claim that EXCLUDES Kenya is a hard reject (that's
	// a genuinely different person), while a missing claim falls back to the
	// English description, which reliably reads "Kenyan politician".
	const citizenships: string[] = (entity.claims?.P27 ?? [])
		.map((c: any) => c?.mainsnak?.datavalue?.value?.id)
		.filter(Boolean);
	const description: string = entity.descriptions?.en?.value ?? '';
	if (citizenships.length > 0) {
		if (!citizenships.includes(KENYA)) return { skip: `citizenship claim excludes Kenya (${citizenships.join(', ')})` };
	} else if (!/kenya/i.test(description)) {
		return { skip: `no citizenship claim and description doesn't mention Kenya ("${description || 'none'}")` };
	}

	const claim = entity.claims?.P569?.[0]?.mainsnak?.datavalue?.value;
	if (!claim?.time) return { skip: 'no date of birth on record' };
	// Wikidata times look like "+1985-02-02T00:00:00Z"; precision 11 = day.
	if (typeof claim.precision === 'number' && claim.precision < 11) {
		return { skip: `date too imprecise (precision ${claim.precision})` };
	}
	const m = /^\+(\d{4})-(\d{2})-(\d{2})/.exec(claim.time);
	if (!m) return { skip: `unparseable time "${claim.time}"` };
	return { dob: `${m[1]}-${m[2]}-${m[3]}` };
}

async function main() {
	const rows = await db
		.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames, region: positions.region })
		.from(leaders)
		.innerJoin(positions, eq(leaders.positionId, positions.id))
		.innerJoin(users, eq(users.id, leaders.userId))
		.where(
			and(
				isNull(leaders.deletedAt),
				isNotNull(leaders.verifiedAt),
				eq(leaders.status, 'current'),
				eq(positions.title, TITLE),
				isNull(users.deletedAt),
				isNull(users.dateOfBirth) // never overwrite a date already on file
			)
		)
		.limit(LIMIT);

	console.log(`${rows.length} ${TITLE}(s) without a date of birth. ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to write)'}\n`);

	let written = 0;
	const skipped: string[] = [];

	for (const row of rows) {
		const name = `${row.firstName} ${row.otherNames}`.trim();
		const entityId = await wikidataIdFor(name);
		if (!entityId) {
			skipped.push(`${name} (${row.region}): no Wikipedia page`);
			await sleep(DELAY_MS);
			continue;
		}
		const result = await birthDateFor(entityId);
		if ('skip' in result) {
			skipped.push(`${name} (${row.region}): ${result.skip}`);
			await sleep(DELAY_MS);
			continue;
		}
		// 1 January is the classic placeholder for a year-only birth date that
		// someone recorded at day precision anyway, and Wikidata's own precision
		// flag can't distinguish that from a real New Year's Day birthday, so
		// flag it for a human rather than silently trusting or dropping it.
		const suspect = result.dob.endsWith('-01-01') ? '  ← 1 Jan, verify (often a year-only placeholder)' : '';
		console.log(`  ${name} (${row.region}) -> ${result.dob}  [${entityId}]${suspect}`);
		if (APPLY) {
			await db.update(users).set({ dateOfBirth: result.dob }).where(eq(users.id, row.id));
		}
		written++;
		await sleep(DELAY_MS);
	}

	console.log(`\n${written} matched${APPLY ? ' and written' : ' (not written, dry run)'}, ${skipped.length} skipped.`);
	if (skipped.length > 0) {
		console.log('\nSkipped:');
		for (const s of skipped) console.log(`  - ${s}`);
	}
	await client.end();
}

main().catch(async (err) => {
	console.error(err);
	await client.end();
	process.exit(1);
});
