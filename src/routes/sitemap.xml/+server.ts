// /sitemap.xml: every public URL on the site, for search engines.
//
// This exists because organic search is the only channel that brings real
// visitors, and without a sitemap a crawler can only find what happens to be
// linked. The 1,163 profile pages are the long tail people actually search for
// (a specific MCA or MP by name), and most of them are several clicks from the
// homepage, so link-following alone leaves them undiscovered.
//
// Built from the same visibility rules the pages themselves enforce, so a URL
// listed here always resolves: a profile needs a held term or a run (see
// resolveTermForUser), a seat hub needs a live positions row, and Country-wide
// seats use their singular path because /presidents/kenya 301s away.
import { and, eq, exists, isNotNull, isNull, sql } from 'drizzle-orm';
import { env as publicEnv } from '$env/dynamic/public';
import { db } from '$lib/server/db';
import { campaigns, leaders, parties, positions, posts, users } from '$lib/server/db/schema';
import { slugify } from '$lib/server/leader';
import { positionSlug, seatPath } from '$lib/utils/seat';
import { RANK_POSITIONS } from '$lib/utils/rankPositions';
import educationArticles from '$lib/data/education.json';
import type { RequestHandler } from './$types';

/** How long a generated sitemap is served before it's rebuilt. The document is
 * ~3,200 URLs off half a dozen table scans, and a crawler may request it many
 * times an hour, so it's built once and held rather than per request. */
const CACHE_MS = 60 * 60 * 1000;

/** Content-bearing pages with no dynamic segment. Deliberately excludes the
 * routes that redirect (/news, /follow), anything behind auth, and /search,
 * which has nothing to index without a query. */
const STATIC_PATHS = [
	'',
	'ballot',
	'compare',
	'demographics',
	'about',
	'alliances',
	'dates',
	'drives',
	'education',
	'faq',
	'features',
	'for-leaders',
	'fundraising',
	'parties',
	'pricing',
	'verify-registration',
	'contact-us',
	'privacy',
	'terms',
	'data-policy'
];

type Entry = { path: string; lastmod?: Date };

let cache: { xml: string; builtAt: number } | null = null;

const escapeXml = (value: string) =>
	value.replace(/[<>&'"]/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`);

async function collect(): Promise<Entry[]> {
	const [profileRows, seatRows, partyRows, postRows] = await Promise.all([
		// Every person with a public page: a held term or a run under their slug.
		// Mirrors resolveTermForUser, which returns null (404) without either.
		db
			.select({ slug: users.slug })
			.from(users)
			.where(
				and(
					isNotNull(users.slug),
					isNull(users.deletedAt),
					sql`(${exists(
						db
							.select({ one: sql`1` })
							.from(leaders)
							.where(and(eq(leaders.userId, users.id), isNull(leaders.deletedAt)))
					)} or ${exists(
						db
							.select({ one: sql`1` })
							.from(campaigns)
							.where(
								and(
									eq(campaigns.subjectUserId, users.id),
									isNull(campaigns.parentCampaignId),
									isNull(campaigns.deletedAt)
								)
							)
					)})`
				)
			),
		db
			.select({ title: positions.title, region: positions.region })
			.from(positions)
			.where(isNull(positions.deletedAt)),
		db.select({ name: parties.name, updatedAt: parties.updatedAt }).from(parties).where(isNull(parties.deletedAt)),
		// Team-published articles at /news/[slug]. Ingested coverage links straight
		// out to the publisher and has no page here, so it never appears.
		db
			.select({ slug: posts.slug, updatedAt: posts.updatedAt })
			.from(posts)
			.innerJoin(users, eq(posts.subjectUserId, users.id))
			.where(
				and(
					eq(posts.medium, 'web'),
					eq(posts.public, true),
					isNotNull(posts.slug),
					isNull(posts.archivedAt),
					isNull(posts.deletedAt),
					isNull(users.deletedAt),
					sql`(${exists(
						db
							.select({ one: sql`1` })
							.from(leaders)
							.where(and(eq(leaders.userId, users.id), isNull(leaders.deletedAt), isNotNull(leaders.verifiedAt)))
					)} or ${exists(
						db
							.select({ one: sql`1` })
							.from(campaigns)
							.where(
								and(
									eq(campaigns.subjectUserId, users.id),
									isNull(campaigns.deletedAt),
									isNotNull(campaigns.verifiedAt)
								)
							)
					)})`
				)
			)
	]);

	const entries: Entry[] = STATIC_PATHS.map((path) => ({ path: `/${path}` }));

	// One directory page per position that actually has seats, e.g. /governors.
	// Derived from the data rather than the slug table, which carries titles
	// (Deputy President) that have no seats and whose directory 404s.
	for (const slug of new Set(seatRows.map((s) => positionSlug(s.title)).filter((s): s is string => !!s))) {
		entries.push({ path: `/${slug}` });
	}
	for (const { slug } of RANK_POSITIONS) entries.push({ path: `/rank/${slug}` });

	// Seat hubs. seatPath sends Country-wide seats to their singular path, which
	// collapses the President's 1 row onto /president.
	//
	// Seats and profiles carry no lastmod: neither table tracks a modification
	// time, and createdAt would claim a page is older than it is, which reads to
	// a crawler as a reason not to come back.
	for (const seat of seatRows) {
		const path = seatPath(seat.title, seat.region);
		if (path) entries.push({ path });
	}
	for (const p of profileRows) entries.push({ path: `/${p.slug}` });
	for (const p of partyRows) entries.push({ path: `/parties/${slugify(p.name)}`, lastmod: p.updatedAt });
	for (const p of postRows) entries.push({ path: `/news/${p.slug}`, lastmod: p.updatedAt });
	for (const a of educationArticles) entries.push({ path: `/education/${a.slug}` });

	// A seat hub and its singular path can collide (every Country seat resolves to
	// the same /president), so dedupe on path and keep the newest lastmod.
	const byPath = new Map<string, Entry>();
	for (const entry of entries) {
		const seen = byPath.get(entry.path);
		if (!seen || (entry.lastmod && (!seen.lastmod || entry.lastmod > seen.lastmod))) byPath.set(entry.path, entry);
	}
	return [...byPath.values()];
}

function render(entries: Entry[], base: string): string {
	const urls = entries
		.map(({ path, lastmod }) => {
			const loc = `<loc>${escapeXml(`${base}${path === '/' ? '/' : path}`)}</loc>`;
			const mod = lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
			return `<url>${loc}${mod}</url>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export const GET: RequestHandler = async () => {
	if (!cache || Date.now() - cache.builtAt > CACHE_MS) {
		const base = (publicEnv.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
		cache = { xml: render(await collect(), base), builtAt: Date.now() };
	}
	return new Response(cache.xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': `public, max-age=${CACHE_MS / 1000}`
		}
	});
};
