// The shareable WhatsApp brief: a leader's latest coverage as a message someone
// can paste straight into a chat. Built server-side so the format, the AI TL;DR,
// and the cache all live in one place, whichever of the three copy buttons on
// the news page triggered it.
//
// Every brief ends with one vote.ke link, which is the point: a brief pasted
// into a WhatsApp group carries a way back to the platform.
import { and, desc, eq, isNull } from 'drizzle-orm';
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
/** Real ingested headlines average ~140 characters (some are a scraped post body
 * running past 200), so they are truncated rather than trusted. */
const HEADLINE_MAX = 80;

export type LeaderBrief = { text: string; count: number; name: string };

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
	// Never blocks the message: a null TL;DR just drops that paragraph.
	const tldr = await summarizeLeaderNews(
		name,
		rows.map((r) => ({ title: decodeHtmlEntities(r.title), body: decodeHtmlEntities(r.body) }))
	);

	// WhatsApp markup: *bold*, _italic_, bare URLs auto-link. No headings or
	// link syntax, so the trailing URL is written plainly.
	const lines = [`*${name}*`, '_Latest 5 stories_', ''];
	// The model is told to write plain prose, but it reads article text that can
	// contain URLs, so its output is stripped too: the only link in the whole
	// message must be ours.
	if (tldr) lines.push(`TL;DR: ${stripLinks(tldr)}`, '');
	for (const r of rows) {
		const outlet = readableOutlet(newsSourceName(r.sourceUrl, decodeHtmlEntities(r.title)));
		const when = dateFmt.format(r.createdAt);
		lines.push(`- ${when}${outlet ? ` · ${outlet}` : ''}: ${tidyHeadline(r.title)}`);
	}
	// "Full coverage", not "More stories": a leader with exactly five articles has
	// no more, but the feed page is still where all of them live.
	lines.push('', `Full coverage: ${origin}/?mention=${slug}`);

	const brief: LeaderBrief = { text: lines.join('\n'), count: rows.length, name };
	cache.set(slug, { newestPostId: rows[0].id, brief });
	return brief;
}
