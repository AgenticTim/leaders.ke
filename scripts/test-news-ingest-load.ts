// One-off load/latency measurement for the redesigned news ingestion (batched
// Google searches + shared "tag everyone mentioned" insert path). Mirrors
// runIngest()'s Google-News half from $lib/server/newsIngest.ts, but as a
// standalone script with its own DB connection (that file imports $env/dynamic/
// private via $lib/server/db, which only resolves inside SvelteKit's own
// runtime — not under a plain `bun run`), so it can be timed in detail without
// touching the app's request/response cycle. If runIngest()'s batching/tagging
// logic changes, mirror the change here too.
//
// Usage: bun run scripts/test-news-ingest-load.ts [--limit 600] [--delay 1000]
import { parseArgs } from 'node:util';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { campaigns, leaders, platformSettings, posts, tags, users } from '../src/lib/server/db/schema';
import { decodeHtmlEntities } from '../src/lib/utils/entities';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

const { values } = parseArgs({
	options: {
		limit: { type: 'string', default: '600' },
		delay: { type: 'string', default: '1000' }
	}
});
const LIMIT_PEOPLE = Number(values.limit);
const DELAY_MS = Number(values.delay);

type FeedItem = { title: string; link: string; description: string; pubDate: Date | null };
type VerifiedPerson = { userId: number; name: string; allowlist: string[] | null };

function fullName(u: { firstName: string; otherNames: string }): string {
	return `${u.firstName} ${u.otherNames}`.trim();
}

function stripHtml(s: string): string {
	return decodeHtmlEntities(decodeHtmlEntities(s).replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

function parseRss(xml: string): FeedItem[] {
	const items: FeedItem[] = [];
	const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
	for (const block of itemBlocks) {
		const pick = (tag: string) => {
			const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
			return m ? decodeHtmlEntities(m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')).trim() : '';
		};
		const title = pick('title');
		const link = pick('link');
		if (!title || !link) continue;
		const pub = pick('pubDate');
		items.push({ title, link, description: stripHtml(pick('description')), pubDate: pub ? new Date(pub) : null });
	}
	return items;
}

function sourceAllowed(person: VerifiedPerson, sourceId: string): boolean {
	return person.allowlist === null || person.allowlist.includes(sourceId);
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

async function listVerifiedPeople(): Promise<VerifiedPerson[]> {
	const [termRows, runRows] = await Promise.all([
		db
			.select({ id: leaders.userId })
			.from(leaders)
			.where(and(isNull(leaders.deletedAt), isNotNull(leaders.verifiedAt))),
		db
			.select({ id: campaigns.subjectUserId })
			.from(campaigns)
			.where(and(isNull(campaigns.deletedAt), isNotNull(campaigns.verifiedAt)))
	]);
	const ids = [...new Set([...termRows, ...runRows].map((r) => r.id).filter((id): id is number => id !== null))];
	if (!ids.length) return [];
	const people = await db
		.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames, allowlist: users.newsSourceAllowlist })
		.from(users)
		.where(and(inArray(users.id, ids), isNull(users.deletedAt)));
	return people
		.map((p) => ({ userId: p.id, name: fullName(p), allowlist: p.allowlist }))
		.filter((p) => p.name.trim().includes(' '));
}

async function ingestArticles(items: FeedItem[], sourceId: string, people: VerifiedPerson[]): Promise<{ inserted: number; matched: number }> {
	let inserted = 0;
	let matched = 0;
	for (const item of items) {
		const text = `${item.title} ${item.description}`.toLowerCase();
		const people_matched = people.filter((p) => text.includes(p.name.toLowerCase()) && sourceAllowed(p, sourceId));
		if (people_matched.length === 0) continue;
		matched++;

		const [byUrl] = await db.select({ id: posts.id }).from(posts).where(eq(posts.sourceUrl, item.link));
		if (byUrl) continue;
		const [byTitle] = await db
			.select({ id: posts.id })
			.from(posts)
			.innerJoin(tags, eq(tags.postId, posts.id))
			.where(
				and(
					eq(posts.title, item.title.slice(0, 255)),
					inArray(
						tags.subjectUserId,
						people_matched.map((p) => p.userId)
					),
					isNull(posts.deletedAt)
				)
			);
		if (byTitle) continue;

		const [post] = await db
			.insert(posts)
			.values({
				title: item.title.slice(0, 255),
				body: item.description || item.title,
				sourceUrl: item.link,
				medium: 'web',
				approved: true,
				public: true,
				...(item.pubDate && !isNaN(item.pubDate.getTime()) ? { createdAt: item.pubDate } : {})
			})
			.onConflictDoNothing({ target: posts.sourceUrl })
			.returning({ id: posts.id });
		if (!post) continue;
		await db.insert(tags).values(people_matched.map((p) => ({ postId: post.id, subjectUserId: p.userId })));
		inserted++;
	}
	return { inserted, matched };
}

function percentile(sorted: number[], p: number): number {
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx];
}

async function main() {
	const [settingsRow] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
	const batchSize = Math.max(1, settingsRow?.newsBatchSize ?? 5);

	let people = await listVerifiedPeople();
	console.log(`Verified leaders available locally: ${people.length}`);
	people = people.slice(0, LIMIT_PEOPLE);
	console.log(`Testing with: ${people.length} leaders, batch size ${batchSize} (from platform_settings), ${DELAY_MS}ms between requests\n`);

	const batches = chunk(people, batchSize);
	console.log(`-> ${batches.length} Google News requests total\n`);

	const fetchLatencies: number[] = [];
	const totalLatencies: number[] = [];
	const rawItemCounts: number[] = [];
	const matchedItemCounts: number[] = [];
	let inserted = 0;
	let requestsFailed = 0;

	const wallStart = performance.now();

	for (const [i, batch] of batches.entries()) {
		const eligible = batch.filter((p) => sourceAllowed(p, 'googleNews'));
		const reqStart = performance.now();
		try {
			if (eligible.length === 0) {
				totalLatencies.push(performance.now() - reqStart);
				continue;
			}
			const query = eligible.map((p) => `"${p.name}"`).join(' OR ');
			const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`(${query}) Kenya`)}&hl=en-KE&gl=KE&ceid=KE:en`;

			const fetchStart = performance.now();
			const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; vote.ke-news/1.0)' } });
			const fetchMs = performance.now() - fetchStart;
			fetchLatencies.push(fetchMs);
			if (!res.ok) throw new Error(`feed ${res.status}`);
			const xml = await res.text();
			const items = parseRss(xml);
			rawItemCounts.push(items.length);

			const { inserted: batchInserted, matched } = await ingestArticles(items, 'googleNews', people);
			matchedItemCounts.push(matched);
			inserted += batchInserted;

			const totalMs = performance.now() - reqStart;
			totalLatencies.push(totalMs);
			process.stdout.write(
				`batch ${i + 1}/${batches.length}: fetch ${fetchMs.toFixed(0)}ms, total ${totalMs.toFixed(0)}ms, ${items.length} items, ${matched} matched, ${batchInserted} inserted\n`
			);
		} catch (err) {
			requestsFailed++;
			totalLatencies.push(performance.now() - reqStart);
			console.error(`batch ${i + 1}/${batches.length} FAILED:`, err instanceof Error ? err.message : err);
		}
		if (i < batches.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
	}

	const wallMs = performance.now() - wallStart;

	const sortedFetch = [...fetchLatencies].sort((a, b) => a - b);
	const sortedTotal = [...totalLatencies].sort((a, b) => a - b);
	const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
	const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

	console.log('\n--- Results ---');
	console.log(`Leaders tested: ${people.length}`);
	console.log(`Requests: ${batches.length} (batch size ${batchSize}), ${requestsFailed} failed`);
	console.log(`Total wall-clock time: ${(wallMs / 1000).toFixed(1)}s`);
	console.log(`  of which ${((sum(fetchLatencies) / 1000)).toFixed(1)}s was Google fetch time, ${(((batches.length - 1) * DELAY_MS) / 1000).toFixed(1)}s was the fixed inter-request delay`);
	console.log(`\nFetch latency (Google request only): min ${Math.min(...fetchLatencies).toFixed(0)}ms / avg ${avg(fetchLatencies).toFixed(0)}ms / p95 ${percentile(sortedFetch, 95).toFixed(0)}ms / max ${Math.max(...fetchLatencies).toFixed(0)}ms`);
	console.log(`Total per-batch latency (fetch + dedup/insert): min ${Math.min(...totalLatencies).toFixed(0)}ms / avg ${avg(totalLatencies).toFixed(0)}ms / p95 ${percentile(sortedTotal, 95).toFixed(0)}ms / max ${Math.max(...totalLatencies).toFixed(0)}ms`);
	console.log(`\nItems per response: min ${Math.min(...rawItemCounts)} / avg ${avg(rawItemCounts).toFixed(1)} / max ${Math.max(...rawItemCounts)}`);
	console.log(`Articles matched to >=1 verified person: ${sum(matchedItemCounts)} total, avg ${avg(matchedItemCounts).toFixed(1)} per response`);
	console.log(`New posts inserted: ${inserted}`);
	console.log(`\nProjected full run (1162 leaders, same batch size): ${Math.ceil(1162 / batchSize)} requests, ~${((Math.ceil(1162 / batchSize) * (avg(totalLatencies) + DELAY_MS)) / 1000 / 60).toFixed(1)} min`);

	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
