// One-off backfill: decode HTML entities (`&nbsp;`, `&#039;`, `&amp;`…) that
// news ingestion stored literally before it learned to fully decode
// double-encoded feeds (see src/lib/utils/entities.ts). Idempotent — rerunning
// finds nothing to change.
//
//   DATABASE_URL=... bun run scripts/clean-post-entities.ts
import { eq, like, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { posts } from '../src/lib/server/db/schema';
import { decodeHtmlEntities } from '../src/lib/utils/entities';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

const rows = await db
	.select({ id: posts.id, title: posts.title, body: posts.body })
	.from(posts)
	.where(or(like(posts.title, '%&%;%'), like(posts.body, '%&%;%')));

let changed = 0;
for (const row of rows) {
	const title = decodeHtmlEntities(row.title);
	const body = decodeHtmlEntities(row.body);
	if (title === row.title && body === row.body) continue;
	await db.update(posts).set({ title, body }).where(eq(posts.id, row.id));
	changed++;
}

console.log(`${rows.length} candidate posts scanned, ${changed} cleaned`);
await client.end();
