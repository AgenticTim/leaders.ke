// Daily news ingestion (TODO 7.1): pulls Google News RSS per verified leader
// and stores matches as aggregated mention posts — the exact shape the seeded
// demo mentions use (posts with a null creatorId + a null-creator tags row per
// mentioned person), so the PR desk, crisis banner, /news mentions and profile
// "In the news" sections all read them with zero changes.
//
// Precision over recall: an item only lands if the leader's FULL name appears
// in its title or snippet, and it only ever tags the one leader whose feed it
// came from — mis-tagging a rival's scandal onto the wrong person is the
// reputational failure mode. Dedupe is by sourceUrl (and title per person), so
// re-runs are no-ops.
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { campaigns, leaders, posts, tags, users } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName } from '$lib/server/leader';
import { classifyMentionSentiment } from '$lib/server/ai';
import { getPlatformSettings } from '$lib/server/settings';

const MAX_ITEMS_PER_PERSON = 5; // newest few per run — a daily cadence never needs more
const MAX_ITEMS_PER_SITE_FEED = 60; // a whole-site feed's newest items checked against every leader
const FETCH_DELAY_MS = 400; // sequential + spaced: a polite crawler Google won't throttle

// Reputable Kenyan outlets whose RSS feeds are checked against every verified
// leader's full name each run (one fetch per feed, not per leader — cheaper
// than the Google News per-person loop below). Admin-toggleable per source on
// /dashboard/admin/settings (platformSettings.newsSources, keyed by these same
// ids). `url: null` means the toggle exists but no working feed has been found
// for that outlet yet — it's skipped even if turned on, so flipping it on does
// nothing harmful while a real URL is filled in later.
export const NEWS_SOURCES: Record<string, { label: string; url: string | null }> = {
	googleNews: { label: 'Google News (per-leader search)', url: null }, // handled by ingestForPerson, not the generic feed loop
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

/** Minimal RSS <item> extraction — Google News RSS is regular enough that a
 * parser dependency isn't worth it. */
function parseRss(xml: string): FeedItem[] {
	const items: FeedItem[] = [];
	const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
	for (const block of itemBlocks) {
		const pick = (tag: string) => {
			const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
			return m ? decodeXml(m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')).trim() : '';
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

function decodeXml(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function stripHtml(s: string): string {
	return decodeXml(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

type VerifiedPerson = { userId: number; name: string; allowlist: string[] | null };

/** Whether `sourceId` is allowed to tag this person: the Dominate-only perk
 * (newsSourceControl) is what lets a person HAVE a non-null allowlist at all —
 * everyone else's is null, i.e. every source allowed, matching today's
 * behavior exactly. */
function sourceAllowed(person: VerifiedPerson, sourceId: string): boolean {
	return person.allowlist === null || person.allowlist.includes(sourceId);
}

/** Every publicly visible person: a verified held term or a verified run this
 * cycle — the same gate the public site uses everywhere. */
async function listVerifiedPeople(): Promise<VerifiedPerson[]> {
	const [termRows, runRows] = await Promise.all([
		db
			.select({ id: leaders.userId })
			.from(leaders)
			.where(and(isNull(leaders.deletedAt), isNotNull(leaders.verifiedAt))),
		db
			.select({ id: campaigns.subjectUserId })
			.from(campaigns)
			.where(and(isNull(campaigns.deletedAt), isNotNull(campaigns.verifiedAt), eq(campaigns.cycleYear, ACTIVE_CYCLE)))
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

async function ingestForPerson(person: VerifiedPerson): Promise<number> {
	if (!sourceAllowed(person, 'googleNews')) return 0;
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${person.name}" Kenya`)}&hl=en-KE&gl=KE&ceid=KE:en`;
	const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; vote.ke-news/1.0)' } });
	if (!res.ok) throw new Error(`feed ${res.status}`);
	const items = parseRss(await res.text());

	const nameLower = person.name.toLowerCase();
	let inserted = 0;
	for (const item of items.slice(0, MAX_ITEMS_PER_PERSON * 3)) {
		if (inserted >= MAX_ITEMS_PER_PERSON) break;
		// Full-name precision guard.
		if (!`${item.title} ${item.description}`.toLowerCase().includes(nameLower)) continue;

		// Dedupe: the same article URL, or the same headline already tagged to
		// this person (outlets occasionally republish under fresh URLs).
		const [byUrl] = await db.select({ id: posts.id }).from(posts).where(eq(posts.sourceUrl, item.link));
		if (byUrl) continue;
		const [byTitle] = await db
			.select({ id: posts.id })
			.from(posts)
			.innerJoin(tags, eq(tags.postId, posts.id))
			.where(and(eq(posts.title, item.title.slice(0, 255)), eq(tags.subjectUserId, person.userId), isNull(posts.deletedAt)));
		if (byTitle) continue;

		const sentiment = await classifyMentionSentiment(person.name, item.title, item.description);
		const [post] = await db
			.insert(posts)
			.values({
				title: item.title.slice(0, 255),
				body: item.description || item.title,
				sourceUrl: item.link,
				medium: 'web',
				sentiment,
				approved: true,
				public: true,
				...(item.pubDate && !isNaN(item.pubDate.getTime()) ? { createdAt: item.pubDate } : {})
			})
			.onConflictDoNothing({ target: posts.sourceUrl })
			.returning({ id: posts.id });
		if (!post) continue; // lost the race to a concurrent run, already inserted
		await db.insert(tags).values({ postId: post.id, subjectUserId: person.userId });
		inserted++;
	}
	return inserted;
}

/** One whole-site feed, checked against every verified leader's full name.
 * A single article can mention several leaders — each gets its own tags row
 * on the same post (same convention as a team post's inline @mentions), and
 * all share one sentiment classification (the article's general tone) rather
 * than a separate AI call per mentioned person. */
async function ingestSiteFeed(sourceId: string, url: string, people: VerifiedPerson[]): Promise<number> {
	const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; vote.ke-news/1.0)' } });
	if (!res.ok) throw new Error(`feed ${res.status}`);
	const items = parseRss(await res.text()).slice(0, MAX_ITEMS_PER_SITE_FEED);

	let inserted = 0;
	for (const item of items) {
		const text = `${item.title} ${item.description}`.toLowerCase();
		const matched = people.filter((p) => text.includes(p.name.toLowerCase()) && sourceAllowed(p, sourceId));
		if (matched.length === 0) continue;

		// Dedupe: the same article URL, or the same headline already tagged to
		// any of the matched people (wire-syndicated stories run verbatim on
		// several outlets under different URLs).
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

		const sentiment = await classifyMentionSentiment(matched.map((p) => p.name).join(', '), item.title, item.description);
		const [post] = await db
			.insert(posts)
			.values({
				title: item.title.slice(0, 255),
				body: item.description || item.title,
				sourceUrl: item.link,
				medium: 'web',
				sentiment,
				approved: true,
				public: true,
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

/** One full pass over every verified person (Google News, per-person) plus
 * every enabled whole-site feed (checked against everyone at once), sequential
 * and politely spaced. `limitPeople` exists for dev smoke tests. */
export async function ingestNews(opts: { limitPeople?: number } = {}): Promise<{ people: number; inserted: number; failed: number }> {
	let people = await listVerifiedPeople();
	// Freshest runs first feels right for an interrupted pass: recently created
	// campaigns are the ones with no coverage yet.
	people = people.slice(0, opts.limitPeople ?? people.length);

	const sources = (await getPlatformSettings()).newsSources;

	let inserted = 0;
	let failed = 0;

	if (sources.googleNews !== false) {
		for (const person of people) {
			try {
				inserted += await ingestForPerson(person);
			} catch (err) {
				failed++;
				console.error(`[news] ingest failed for ${person.name}:`, err instanceof Error ? err.message : err);
			}
			await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
		}
	}

	for (const [sourceId, source] of Object.entries(NEWS_SOURCES)) {
		if (sourceId === 'googleNews' || !source.url || sources[sourceId] === false) continue;
		try {
			inserted += await ingestSiteFeed(sourceId, source.url, people);
		} catch (err) {
			failed++;
			console.error(`[news] ingest failed for ${source.label}:`, err instanceof Error ? err.message : err);
		}
		await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
	}

	await backfillSentiment();

	return { people: people.length, inserted, failed };
}

/** Classifies mentions that predate sentiment (seeded demo rows, articles
 * ingested before 7.2) — a bounded batch per run, so a large backlog drains
 * across a few daily sweeps instead of burning one giant API session. */
async function backfillSentiment(batch = 40): Promise<void> {
	const rows = await db
		.select({ id: posts.id, title: posts.title, body: posts.body, taggedUserId: tags.subjectUserId })
		.from(posts)
		.innerJoin(tags, eq(tags.postId, posts.id))
		.where(and(isNull(posts.creatorId), isNull(posts.sentiment), isNull(posts.deletedAt), isNull(tags.deletedAt)))
		.limit(batch);
	for (const row of rows) {
		const [person] = await db.select({ firstName: users.firstName, otherNames: users.otherNames }).from(users).where(eq(users.id, row.taggedUserId));
		const sentiment = await classifyMentionSentiment(person ? fullName(person) : '', row.title, row.body);
		await db.update(posts).set({ sentiment }).where(eq(posts.id, row.id));
	}
}
