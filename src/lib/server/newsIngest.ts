// Daily news ingestion (TODO 7.1): pulls Google News RSS, batched across several
// leaders per search, and stores matches as aggregated mention posts. The exact
// shape the seeded demo mentions use (posts with a null creatorId + a null-creator
// tags row per mentioned person), so the PR desk, crisis banner, /news mentions and
// profile "Latest News" sections all read them with zero changes.
//
// Precision over recall: an item only lands if a leader's FULL name appears in its
// title or snippet. Unlike an earlier version, an article now tags EVERY verified
// leader actually named in it, not just whichever search/feed happened to surface
// it. The same person can be found via their own batched Google search, someone
// else's, or a whole-site feed, and gets tagged consistently regardless of which
// path found the article first. Dedupe is by sourceUrl (and title per matched
// person), so re-runs are no-ops.
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, leaders, platformSettings, positions, posts, tags, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName } from '$lib/server/leader';
import { getPlatformSettings } from '$lib/server/settings';
import { classifyMentionSentimentBatch } from '$lib/server/ai';
import { decodeHtmlEntities } from '$lib/utils/entities';

const MAX_ITEMS_PER_SITE_FEED = 60; // a whole-site feed's newest items checked against every leader
const FETCH_DELAY_MS = 400; // sequential + spaced: a polite crawler Google won't throttle
const SENTIMENT_BATCH_SIZE = 25; // articles per Anthropic call, fewer, bigger calls beat one call per post
const SENTIMENT_CONCURRENCY = 5; // Haiku calls in flight at once; Google's rate limits don't apply here

// Reputable Kenyan outlets whose RSS feeds are checked against every verified
// leader's full name each run (one fetch per feed, not per leader, cheaper
// than the Google News batched search below). Admin-toggleable per source on
// /dashboard/admin/settings (platformSettings.newsSources, keyed by these same
// ids). `url: null` means the toggle exists but no working feed has been found
// for that outlet yet. It's skipped even if turned on, so flipping it on does
// nothing harmful while a real URL is filled in later.
export const NEWS_SOURCES: Record<string, { label: string; url: string | null }> = {
	googleNews: { label: 'Google News (batched leader search)', url: null }, // handled by ingestForBatch, not the generic feed loop
	nationAfrica: { label: 'Daily Nation (nation.africa)', url: 'https://nation.africa/kenya/rss.xml' },
	standardMedia: { label: 'The Standard', url: 'https://www.standardmedia.co.ke/rss/headlines.php' },
	theStar: { label: 'The Star', url: null },
	businessDaily: { label: 'Business Daily Africa', url: null },
	citizenDigital: { label: 'Citizen Digital', url: null },
	capitalFm: { label: 'Capital FM News', url: 'https://www.capitalfm.co.ke/news/feed/' },
	kbc: { label: 'KBC', url: 'https://www.kbc.co.ke/feed/' },
	kenyaTimes: { label: 'The Kenya Times', url: null },
	ktnNews: { label: 'KTN News', url: null },
	peopleDaily: { label: 'People Daily', url: null }
};

type FeedItem = { title: string; link: string; description: string; pubDate: Date | null };

/** Minimal RSS <item> extraction, Google News RSS is regular enough that a
 * parser dependency isn't worth it. */
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
		items.push({
			title,
			link,
			description: stripHtml(pick('description')),
			pubDate: pub ? new Date(pub) : null
		});
	}
	return items;
}

// Entity decoding is decodeHtmlEntities (entities.ts): feeds double-encode, so
// a single XML-level pass used to leave literal `&nbsp;`/`&#039;` in stored
// excerpts. The shared util loops until stable. Strip tags between decodes:
// the first pass materializes any encoded markup, the second cleans what the
// markup itself carried.
function stripHtml(s: string): string {
	return decodeHtmlEntities(decodeHtmlEntities(s).replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

// seats: every "<boundary>:<region>" key the person's verified terms/runs span
// (e.g. "County:Nakuru"), inherited onto each article they're tagged in
// (posts.regions) so the homepage's local-news filter can match the article
// itself, not just its author.
type VerifiedPerson = { userId: number; name: string; allowlist: string[] | null; seats: string[] };

/** Whether `sourceId` is allowed to tag this person: the Dominate-only perk
 * (newsSourceControl) is what lets a person HAVE a non-null allowlist at all,
 * everyone else's is null, i.e. every source allowed, matching today's
 * behavior exactly. */
function sourceAllowed(person: VerifiedPerson, sourceId: string): boolean {
	return person.allowlist === null || person.allowlist.includes(sourceId);
}

/** Every publicly visible person: a verified held term or a verified run this
 * cycle. The same gate the public site uses everywhere. */
async function listVerifiedPeople(): Promise<VerifiedPerson[]> {
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
			.where(and(isNull(campaigns.deletedAt), isNotNull(campaigns.verifiedAt), eq(campaigns.cycleYear, ACTIVE_CYCLE)))
	]);
	const seatsById = new Map<number, Set<string>>();
	for (const r of [...termRows, ...runRows]) {
		if (r.id === null) continue;
		const set = seatsById.get(r.id) ?? new Set<string>();
		set.add(`${r.boundary}:${r.region}`);
		seatsById.set(r.id, set);
	}
	const ids = [...seatsById.keys()];
	if (!ids.length) return [];
	const people = await db
		.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames, allowlist: users.newsSourceAllowlist })
		.from(users)
		.where(and(inArray(users.id, ids), isNull(users.deletedAt)));
	return people
		.map((p) => ({ userId: p.id, name: fullName(p), allowlist: p.allowlist, seats: [...(seatsById.get(p.id) ?? [])] }))
		.filter((p) => p.name.trim().includes(' '));
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/** The one insert path every source funnels through: given a raw list of feed
 * items and the FULL verified-people roster, tags each article with every
 * person actually named in it (not just whoever's search/feed produced the
 * item), subject to that person's own source allowlist. Sentiment isn't
 * classified inline here, posts land with `sentiment` null and get picked up
 * by classifyPendingSentiment() at the end of the run, batched instead of one
 * Anthropic call per post. Returns how many new posts were inserted. */
async function ingestArticles(items: FeedItem[], sourceId: string, people: VerifiedPerson[]): Promise<number> {
	let inserted = 0;
	for (const item of items) {
		const text = `${item.title} ${item.description}`.toLowerCase();
		const matched = people.filter((p) => text.includes(p.name.toLowerCase()) && sourceAllowed(p, sourceId));
		if (matched.length === 0) continue;

		// Dedupe: the same article URL, or the same headline already tagged to
		// any of the matched people (wire-syndicated stories run verbatim on
		// several outlets under different URLs; the same article can also
		// surface again from a different search/feed).
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
						matched.map((p) => p.userId)
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
				// The article's own geography: every seat its tagged people span.
				regions: [...new Set(matched.flatMap((p) => p.seats))],
				...(item.pubDate && !isNaN(item.pubDate.getTime()) ? { createdAt: item.pubDate } : {})
			})
			.onConflictDoNothing({ target: posts.sourceUrl })
			.returning({ id: posts.id });
		if (!post) continue; // lost the race to a concurrent run, already inserted
		await db.insert(tags).values(matched.map((p) => ({ postId: post.id, subjectUserId: p.userId })));
		inserted++;
	}
	return inserted;
}

/** Recency window on every Google News query. Google ranks its 100 results by
 * relevance, not date: measured against the live feed, an unfiltered query
 * returned only 17 articles from the past week, so ~83% of each response was
 * backlog the crawl had usually seen already. `when:7d` returns ~66 items, all
 * fresh. Seven days rather than one gives a wide margin: a few missed runs (or
 * an outage) still get caught up on the next one.
 *
 * The scheduled crawl uses this; admins' manual "Crawl now" passes null to drop
 * the window entirely and pull the full relevance-ranked 100 per query, which is
 * how a new leader's back catalogue gets picked up (see ingestNews's `recency`). */
const RECENCY_WINDOW = 'when:7d';

/** One Google News search covering a BATCH of people at once (an OR'd quoted-name
 * query) instead of one request per person. The request volume at one-per-person
 * was risking rate-limiting/blocking from Google. The whole response (not just a
 * lookahead slice) is handed to ingestArticles, so every person named in the
 * batch's results gets tagged, not only the top-ranked few. */
async function ingestForBatch(
	batch: VerifiedPerson[],
	people: VerifiedPerson[],
	recency: string | null
): Promise<number> {
	const eligible = batch.filter((p) => sourceAllowed(p, 'googleNews'));
	if (eligible.length === 0) return 0;
	const query = eligible.map((p) => `"${p.name}"`).join(' OR ');
	const q = `(${query}) Kenya${recency ? ` ${recency}` : ''}`;
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-KE&gl=KE&ceid=KE:en`;
	const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; vote.ke-news/1.0)' } });
	if (!res.ok) throw new Error(`feed ${res.status}`);
	const items = parseRss(await res.text());
	return ingestArticles(items, 'googleNews', people);
}

/** One whole-site feed, checked against every verified leader's full name, same
 * shared multi-tag insert path as the batched Google searches. */
async function ingestSiteFeed(sourceId: string, url: string, people: VerifiedPerson[]): Promise<number> {
	const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; vote.ke-news/1.0)' } });
	if (!res.ok) throw new Error(`feed ${res.status}`);
	const items = parseRss(await res.text()).slice(0, MAX_ITEMS_PER_SITE_FEED);
	return ingestArticles(items, sourceId, people);
}

/** Runs `fn` over every item, at most `concurrency` calls in flight at once. */
async function eachWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const item = items[next++];
			await fn(item);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/** Every mention post still missing a sentiment (new inserts from this run, plus
 * any backlog from before), grouped with the name(s) of everyone it's tagged to.
 * A post's sentiment is one value covering all of them, same as before. */
async function listPendingSentimentPosts(): Promise<{ id: number; title: string; body: string; names: string[] }[]> {
	const rows = await db
		.select({ postId: posts.id, title: posts.title, body: posts.body, firstName: users.firstName, otherNames: users.otherNames })
		.from(posts)
		.innerJoin(tags, eq(tags.postId, posts.id))
		.innerJoin(users, eq(users.id, tags.subjectUserId))
		.where(and(isNull(posts.creatorId), isNull(posts.sentiment), isNull(posts.deletedAt), isNull(tags.deletedAt)));

	const byPost = new Map<number, { title: string; body: string; names: string[] }>();
	for (const r of rows) {
		const entry = byPost.get(r.postId) ?? { title: r.title, body: r.body, names: [] };
		entry.names.push(fullName(r));
		byPost.set(r.postId, entry);
	}
	return [...byPost.entries()].map(([id, v]) => ({ id, ...v }));
}

/** Classifies every post still missing a sentiment, SENTIMENT_BATCH_SIZE posts
 * per Anthropic call (one call per post would mean thousands of sequential
 * round trips against a backlog this size), with SENTIMENT_CONCURRENCY batches
 * in flight at once. Decoupled from the fetch/insert pipeline above, called
 * once at the end of a run rather than interleaved per-item, so a slow or
 * failed classification never blocks or fails an actual ingest. */
export async function classifyPendingSentiment(): Promise<{ classified: number; failed: number }> {
	const pending = await listPendingSentimentPosts();
	if (pending.length === 0) return { classified: 0, failed: 0 };

	const batches = chunk(pending, SENTIMENT_BATCH_SIZE);
	let classified = 0;
	let failed = 0;

	await eachWithConcurrency(batches, SENTIMENT_CONCURRENCY, async (batch) => {
		try {
			const sentiments = await classifyMentionSentimentBatch(batch.map((p) => ({ leaderName: p.names.join(', '), title: p.title, body: p.body })));
			await Promise.all(batch.map((p, i) => db.update(posts).set({ sentiment: sentiments[i] }).where(eq(posts.id, p.id))));
			classified += batch.length;
		} catch (err) {
			failed += batch.length;
			console.error(`[news] sentiment batch failed (${batch.length} posts):`, err instanceof Error ? err.message : err);
		}
	});

	console.log(`[news] sentiment: classified ${classified} posts${failed ? `, ${failed} failed` : ''}`);
	return { classified, failed };
}

// Guards against two ingestNews() passes running at once (the scheduler firing
// the same minute as an admin's manual "Crawl now" click). The source_url
// unique index already makes concurrent inserts safe, but a lock avoids the
// wasted double fetch work of a genuinely overlapping run.
let ingestInFlight = false;

/** One full pass: every verified person's name, batched across Google News
 * searches, plus every enabled whole-site feed (checked against everyone at
 * once), sequential and politely spaced. `limitPeople` and `delayMs` exist for
 * dev smoke tests / load tests, overriding the real batch-size setting's
 * request cadence. Records platformSettings.newsLastFetchedAt on completion
 * regardless of outcome, so a run that failed midway still shows as attempted
 * rather than silently stale. */
export async function ingestNews(
	opts: { limitPeople?: number; delayMs?: number; recency?: string | null } = {}
): Promise<{ people: number; requests: number; inserted: number; failed: number; sentimentClassified: number; sentimentFailed: number; skipped?: true }> {
	if (ingestInFlight) return { people: 0, requests: 0, inserted: 0, failed: 0, sentimentClassified: 0, sentimentFailed: 0, skipped: true };
	ingestInFlight = true;
	try {
		return await runIngest(opts);
	} finally {
		ingestInFlight = false;
	}
}

async function runIngest(
	opts: { limitPeople?: number; delayMs?: number; recency?: string | null }
): Promise<{ people: number; requests: number; inserted: number; failed: number; sentimentClassified: number; sentimentFailed: number }> {
	let people = await listVerifiedPeople();
	// Freshest runs first feels right for an interrupted pass: recently created
	// campaigns are the ones with no coverage yet.
	people = people.slice(0, opts.limitPeople ?? people.length);

	const settings = await getPlatformSettings();
	const sources = settings.newsSources;
	const delayMs = opts.delayMs ?? FETCH_DELAY_MS;
	// undefined means "use the scheduled window"; an explicit null means no window.
	const recency = opts.recency === undefined ? RECENCY_WINDOW : opts.recency;

	let requests = 0;
	let inserted = 0;
	let failed = 0;

	if (sources.googleNews !== false) {
		for (const batch of chunk(people, Math.max(1, settings.newsBatchSize))) {
			requests++;
			try {
				inserted += await ingestForBatch(batch, people, recency);
			} catch (err) {
				failed++;
				console.error(`[news] batch ingest failed (${batch.length} leaders):`, err instanceof Error ? err.message : err);
			}
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}

	for (const [sourceId, source] of Object.entries(NEWS_SOURCES)) {
		if (sourceId === 'googleNews' || !source.url || sources[sourceId] === false) continue;
		requests++;
		try {
			inserted += await ingestSiteFeed(sourceId, source.url, people);
		} catch (err) {
			failed++;
			console.error(`[news] ingest failed for ${source.label}:`, err instanceof Error ? err.message : err);
		}
		await new Promise((r) => setTimeout(r, delayMs));
	}

	const { classified: sentimentClassified, failed: sentimentFailed } = await classifyPendingSentiment();

	await db.update(platformSettings).set({ newsLastFetchedAt: new Date() }).where(eq(platformSettings.id, 1));

	return { people: people.length, requests, inserted, failed, sentimentClassified, sentimentFailed };
}
