// One-off backfill for posts.regions: aggregated mentions ingested before the
// column existed get the same "<boundary>:<region>" keys new ingests store,
// inherited from their tagged people's verified seats. Idempotent (only touches
// rows where regions is null); team posts are left null on purpose, the
// homepage filter resolves those via the author's seat at read time.
//
// Usage: bun run scripts/backfill-post-regions.ts [--apply]
// Dry-run by default: prints what it would set, writes nothing.
import { parseArgs } from 'node:util';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { campaigns, leaders, positions, posts, tags } from '../src/lib/server/db/schema';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });

async function main() {
	// Seats per person, same union new ingests use (verified terms + verified runs).
	const [termRows, runRows] = await Promise.all([
		db
			.select({ id: leaders.userId, region: positions.region, boundary: positions.boundary })
			.from(leaders)
			.innerJoin(positions, eq(leaders.positionId, positions.id))
			.where(and(isNull(leaders.deletedAt), isNotNull(leaders.verifiedAt))),
		db
			.select({ id: campaigns.subjectUserId, region: positions.region, boundary: positions.boundary })
			.from(campaigns)
			.innerJoin(positions, eq(campaigns.positionId, positions.id))
			.where(and(isNull(campaigns.deletedAt), isNotNull(campaigns.verifiedAt)))
	]);
	const seatsById = new Map<number, Set<string>>();
	for (const r of [...termRows, ...runRows]) {
		if (r.id === null) continue;
		const set = seatsById.get(r.id) ?? new Set<string>();
		set.add(`${r.boundary}:${r.region}`);
		seatsById.set(r.id, set);
	}

	// Every regionless aggregated mention with its tagged people.
	const rows = await db
		.select({ postId: posts.id, taggedUserId: tags.subjectUserId })
		.from(posts)
		.innerJoin(tags, eq(tags.postId, posts.id))
		.where(and(isNull(posts.creatorId), isNull(posts.regions), isNull(posts.deletedAt), isNull(tags.deletedAt)));
	const taggedByPost = new Map<number, number[]>();
	for (const r of rows) {
		const list = taggedByPost.get(r.postId) ?? [];
		list.push(r.taggedUserId);
		taggedByPost.set(r.postId, list);
	}

	console.log(`${taggedByPost.size} regionless mention posts to backfill (${values.apply ? 'APPLYING' : 'dry run'})`);
	let updated = 0;
	let empty = 0;
	for (const [postId, userIds] of taggedByPost) {
		const regions = [...new Set(userIds.flatMap((id) => [...(seatsById.get(id) ?? [])]))];
		if (regions.length === 0) {
			empty++;
			continue; // tagged people have no verified seat today; leave null for the read-time fallback
		}
		if (values.apply) {
			await db.update(posts).set({ regions }).where(eq(posts.id, postId));
			updated++;
		} else if (updated < 5) {
			console.log(`  post ${postId} -> ${regions.join(', ')}`);
			updated++;
		}
	}
	console.log(values.apply ? `${updated} updated, ${empty} left null (no verified seats)` : `(sample above; ${empty} would stay null)`);
	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
