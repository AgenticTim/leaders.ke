// The shareable WhatsApp brief: a leader's latest coverage as a message someone
// can paste straight into a chat. Built server-side so the format, the AI TL;DR,
// and the cache all live in one place, whichever of the three copy buttons on
// the news page triggered it.
//
// Every brief ends with one vote.ke link, which is the point: a brief pasted
// into a WhatsApp group carries a way back to the platform.
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { posts, tags, users } from '$lib/server/db/schema';
import { fullName } from '$lib/server/leader';
import { summarizeLeaderNews } from '$lib/server/ai';
import { decodeHtmlEntities } from '$lib/utils/entities';
import { newsSourceName, publisherFromTitle, readableOutlet, stripLinks } from '$lib/utils/newsSource';

/** Stories per brief. WhatsApp collapses a message past roughly 1000 characters
 * behind "Read more", which would hide the trailing link, so the story count and
 * HEADLINE_MAX below are the two levers that keep the whole message visible. */
const BRIEF_ITEMS = 5;
/** Hard ceiling for the assembled message, a little under WhatsApp's collapse
 * point. The TL;DR is the only elastic part, so it absorbs any overflow: the
 * five headlines and the trailing link always survive intact. */
const MESSAGE_MAX = 980;
/** Real ingested headlines average ~140 characters (some are a scraped post body
 * running past 200), so they are truncated rather than trusted. */
const HEADLINE_MAX = 100;

// `tldr` is the AI paragraph on its own, returned separately from `text` so the
// copy confirmation can show just that instead of the whole (tall) message.
export type LeaderBrief = { text: string; count: number; name: string; tldr: string | null };

/** Days of coverage behind the brief's tone sparkline and its trend line. */
const TONE_DAYS = 30;
/** Unicode blocks, low to high: a WhatsApp message is plain text, so the only
 * chart available is one made of characters. */
const BLOCKS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587'];
/** Below this there is no trend worth stating, so the line is omitted rather
 * than dressing up two articles as a movement. */
const MIN_TONE_ARTICLES = 5;

const dateFmt = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' });

/** Cached briefs keyed by leader slug. The stored `newestPostId` is what makes a
 * brief expire: the next crawl that tags this person with a newer article shifts
 * the id and the entry is rebuilt. No TTL to tune, and no window in which a
 * brief can be stale. Process-local, so a restart simply regenerates. */
const cache = new Map<string, { newestPostId: number; brief: LeaderBrief }>();

/** A headline fit for one WhatsApp line: entity-decoded, stripped of the
 * " - Publisher" suffix Google News appends (the line already names the outlet),
 * stripped of anything WhatsApp would auto-link, collapsed onto one line, and
 * truncated. */
function tidyHeadline(title: string): string {
	let text = decodeHtmlEntities(title).replace(/\s+/g, ' ').trim();
	const publisher = publisherFromTitle(text);
	if (publisher) text = text.slice(0, text.length - publisher.length - 3).trim();
	text = stripLinks(text);
	return text.length > HEADLINE_MAX ? `${text.slice(0, HEADLINE_MAX - 1).trimEnd()}…` : text;
}


/** A leader's 30-day tone as a text sparkline plus a plain-language trend, for
 * the brief's header line. Returns null when there isn't enough classified
 * coverage to claim a trend. Net tone (positive minus negative) per day, the
 * same series the on-site sparkline plots, since two thirds of coverage is
 * neutral and raw volume would be a flat line. */
async function toneLine(subjectUserId: number): Promise<string | null> {
	const rows = await db
		.select({
			day: sql<string>`date(${posts.createdAt})`.as('day'),
			positive: sql<number>`count(*) filter (where ${posts.sentiment} = 'positive')`.mapWith(Number),
			negative: sql<number>`count(*) filter (where ${posts.sentiment} = 'negative')`.mapWith(Number)
		})
		.from(tags)
		.innerJoin(posts, eq(tags.postId, posts.id))
		.where(
			and(
				eq(tags.subjectUserId, subjectUserId),
				isNull(tags.deletedAt),
				isNull(posts.deletedAt),
				isNotNull(posts.sentiment),
				sql`${posts.createdAt} > now() - interval '30 days'`
			)
		)
		.groupBy(sql`date(${posts.createdAt})`);

	const totals = rows.reduce((sum, r) => sum + r.positive + r.negative, 0);
	if (totals < MIN_TONE_ARTICLES) return null;

	// Dense buckets so quiet days read as zero rather than closing the gap.
	const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), r.positive - r.negative]));
	const series: number[] = [];
	for (let i = TONE_DAYS - 1; i >= 0; i--) {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - i);
		series.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
	}

	// One block per ~4 days: 30 characters of sparkline would wrap on a phone.
	const BUCKETS = 8;
	const size = Math.ceil(series.length / BUCKETS);
	const buckets: number[] = [];
	for (let i = 0; i < series.length; i += size) {
		buckets.push(series.slice(i, i + size).reduce((sum, v) => sum + v, 0));
	}
	// Blocks encode magnitude only (they have no below-baseline half), so the
	// scale is shifted to run from the most negative bucket to the most positive
	// and the direction is spelled out in words after it.
	const lo = Math.min(...buckets);
	const hi = Math.max(...buckets);
	const span = hi - lo || 1;
	const spark = buckets
		.map((v) => BLOCKS[Math.min(BLOCKS.length - 1, Math.round(((v - lo) / span) * (BLOCKS.length - 1)))])
		.join('');

	const negatives = rows.reduce((sum, r) => sum + r.negative, 0);
	const share = Math.round((negatives / totals) * 100);
	const half = Math.ceil(buckets.length / 2);
	const early = buckets.slice(0, half).reduce((sum, v) => sum + v, 0);
	const late = buckets.slice(half).reduce((sum, v) => sum + v, 0);
	const arrow = late > early ? '\u2197' : late < early ? '\u2198' : '\u2192';
	return `${share}% negative this month. ${spark} ${arrow}`;
}

/**
 * Builds (or returns the cached) brief for one leader slug. Null when the slug
 * matches nobody or they have no coverage at all, which callers surface as
 * "no recent news" rather than copying an empty message.
 */
export async function getLeaderBrief(slug: string, origin: string): Promise<LeaderBrief | null> {
	const [person] = await db
		.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames })
		.from(users)
		.where(and(eq(users.slug, slug), isNull(users.deletedAt)));
	if (!person) return null;

	const rows = await db
		.select({ id: posts.id, title: posts.title, body: posts.body, sourceUrl: posts.sourceUrl, createdAt: posts.createdAt })
		.from(tags)
		.innerJoin(posts, eq(tags.postId, posts.id))
		.where(and(eq(tags.subjectUserId, person.id), isNull(tags.deletedAt), isNull(posts.deletedAt)))
		.orderBy(desc(posts.createdAt))
		.limit(BRIEF_ITEMS);
	if (rows.length === 0) return null;

	const cached = cache.get(slug);
	if (cached && cached.newestPostId === rows[0].id) return cached.brief;

	const name = fullName(person);
	const tone = await toneLine(person.id);
	// Never blocks the message: a null TL;DR just drops that paragraph.
	const tldr = await summarizeLeaderNews(
		name,
		rows.map((r) => ({ title: decodeHtmlEntities(r.title), body: decodeHtmlEntities(r.body) }))
	);

	// WhatsApp markup: *bold*, _italic_, bare URLs auto-link. No headings or
	// link syntax, so the trailing URL is written plainly.
	const lines = [`*${name}* Latest News ${tone ? ` · ${tone}` : ''}`, ''];
	// The model is told to write plain prose, but it reads article text that can
	// contain URLs, so its output is stripped too: the only link in the whole
	// message must be ours. A placeholder holds the TL;DR's place until the rest
	// of the message is measured (see the trim below).
	const tldrIndex = tldr ? lines.push('', '') - 2 : -1;
	for (const r of rows) {
		const outlet = readableOutlet(newsSourceName(r.sourceUrl, decodeHtmlEntities(r.title)));
		const when = dateFmt.format(r.createdAt);
		// Blank line after each story: WhatsApp runs consecutive lines together,
		// and a wrapped 100-character headline needs the separation to stay scannable.
		lines.push(`- ${when}${outlet ? ` · ${outlet}` : ''}: ${tidyHeadline(r.title)}`, '');
	}
	// "Full coverage", not "More stories": a leader with exactly five articles has
	// no more, but the feed page is still where all of them live. The loop above
	// already left a blank line, so this appends directly.
	lines.push(`Full coverage: ${origin}/?mention=${slug}`);

	// Fit the TL;DR to whatever room the headlines left. A long name, long
	// headlines or a verbose model reply can each eat the budget, and the link
	// disappearing behind "Read more" would defeat the whole feature.
	let finalTldr: string | null = null;
	if (tldrIndex >= 0 && tldr) {
		const fixed = lines.join('\n').length; // the two placeholder lines contribute nothing
		const room = MESSAGE_MAX - fixed - 'TL;DR: '.length;
		const text = stripLinks(tldr);
		finalTldr = room <= 0 ? null : text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text;
		if (finalTldr) lines[tldrIndex] = `TL;DR: ${finalTldr}`;
		else lines.splice(tldrIndex, 2); // no room at all: drop the block, blank line included
	}

	const brief: LeaderBrief = { text: lines.join('\n'), count: rows.length, name, tldr: finalTldr };
	cache.set(slug, { newestPostId: rows[0].id, brief });
	return brief;
}
