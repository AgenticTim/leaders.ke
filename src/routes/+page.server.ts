import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { posts, tags, users, leaders, campaigns, positions } from '$lib/server/db/schema';
import { ACTIVE_CYCLE, fullName, getDomainUser, leaderPath } from '$lib/server/leader';
import { listFollowedAuthors } from '$lib/server/citizen';
import { findCountyBySlug, findConstituencyBySlug, findWardBySlug } from '$lib/data/geo';
import { plainText } from '$lib/utils/richtext';
import { getPageSize } from '$lib/server/settings';
import { decodeHtmlEntities } from '$lib/utils/entities';
import { newsSourceName } from '$lib/utils/newsSource';
import type { PageServerLoad } from './$types';

const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();

type Article = {
	kind: 'post' | 'mention';
	id: number;
	title: string;
	excerpt: string;
	tags: string[];
	mentions: { slug: string; name: string }[];
	authorName: string;
	authorInitials: string;
	authorPhotoUrl: string | null;
	authorUserId: number | null; // FollowCard target: the author's users.id
	authorOffice: string | null; // seat shown beside the byline, e.g. "Governor, Nakuru"
	authorPath: string;
	href: string;
	external: boolean;
	// The outlet an external mention links out to (Google News title suffix, or
	// the link's host). Null for team posts and when neither is derivable.
	sourceName: string | null;
	// Tone toward the tagged leader, classified at ingest. Null for team posts
	// and for mentions the classifier hasn't reached yet.
	sentiment: string | null;
	createdAt: string;
	// The article's own "<boundary>:<region>" keys, stored at ingest from its
	// tagged people's seats (posts.regions). Null for team posts and rows from
	// before the column existed, which match geo via the author's seat instead.
	regions: string[] | null;
};

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const pageSize = await getPageSize();
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
	const activeTag = url.searchParams.get('tag') ?? '';
	const activeMention = url.searchParams.get('mention') ?? '';
	const countySlug = url.searchParams.get('county') ?? '';
	const constituencySlug = url.searchParams.get('constituency') ?? '';
	const wardSlug = url.searchParams.get('ward') ?? '';
	const county = countySlug ? findCountyBySlug(countySlug) : undefined;
	const constituency = county && constituencySlug ? findConstituencyBySlug(constituencySlug) : undefined;
	const ward = constituency && wardSlug ? findWardBySlug(wardSlug) : undefined;

	// "Following": signed-in only, folded in from the old /dashboard feed. One
	// button per leader actually followed (see followedAuthors below), not a
	// single catch-all toggle. ?author=<personId> filters to just that one.
	const domainUser = event.locals.user ? await getDomainUser(event.locals.user.id) : undefined;
	const followedAuthors = domainUser ? await listFollowedAuthors(domainUser.id) : [];
	const activeAuthorRaw = Number(url.searchParams.get('author') ?? '');
	const activeAuthor = followedAuthors.some((a) => a.personId === activeAuthorRaw) ? activeAuthorRaw : 0;

	// Only posts about/from a publicly visible person: a verified held term, or a
	// verified aspirant campaign, same gate the rest of the platform uses. Each
	// row also carries its seat's region/boundary, so "local news" can filter to
	// whichever level(s) of geography the visitor picked.
	const [verifiedLeaderRows, verifiedCampaignRows] = await Promise.all([
		db
			.select({ id: leaders.userId, title: positions.title, region: positions.region, boundary: positions.boundary, status: leaders.status })
			.from(leaders)
			.innerJoin(positions, eq(leaders.positionId, positions.id))
			.where(and(isNull(leaders.deletedAt), isNotNull(leaders.verifiedAt)))
			// Newest term first, so the byline's office falls back to a person's
			// most recent past seat rather than whichever row postgres returned
			// first (see officeByUserId, which keeps the first at each rank).
			.orderBy(desc(leaders.startAt)),
		db
			.select({ id: campaigns.subjectUserId, title: positions.title, region: positions.region, boundary: positions.boundary })
			.from(campaigns)
			.innerJoin(positions, eq(campaigns.positionId, positions.id))
			.where(and(isNull(campaigns.deletedAt), isNotNull(campaigns.verifiedAt), eq(campaigns.cycleYear, ACTIVE_CYCLE)))
	]);
	const publicUserIds = [...new Set([...verifiedLeaderRows, ...verifiedCampaignRows].map((r) => r.id).filter((id): id is number => id !== null))];

	// Every (region, boundary) a person's seat currently spans. A held term AND
	// a fresh run can both be active for the same person, so this is a list, not
	// a single value.
	const seatsByUserId = new Map<number, { region: string; boundary: string }[]>();
	for (const r of [...verifiedLeaderRows, ...verifiedCampaignRows]) {
		if (r.id === null) continue;
		const list = seatsByUserId.get(r.id) ?? [];
		list.push({ region: r.region, boundary: r.boundary });
		seatsByUserId.set(r.id, list);
	}

	// The office shown beside a byline ("Governor, Nakuru"). One person can have
	// several verified terms (a whole track record) plus a run, so this ranks
	// them the way the rest of the platform resolves a lead seat rather than
	// letting row order decide: the seat they hold now, else the one they're
	// vying for, else their most recent past seat. National seats drop the
	// region, which is always "Kenya".
	const SEAT_RANK = { current: 0, run: 1, former: 2 } as const;
	const officeByUserId = new Map<number, { label: string; rank: number }>();
	const considerOffice = (id: number | null, title: string, region: string, rank: number) => {
		if (id === null) return;
		const existing = officeByUserId.get(id);
		if (existing && existing.rank <= rank) return;
		officeByUserId.set(id, { label: region && region !== 'Kenya' ? `${title}, ${region}` : title, rank });
	};
	for (const r of verifiedLeaderRows)
		considerOffice(r.id, r.title, r.region, r.status === 'former' ? SEAT_RANK.former : SEAT_RANK.current);
	for (const r of verifiedCampaignRows) considerOffice(r.id, r.title, r.region, SEAT_RANK.run);
	// Whichever levels the visitor picked. Strictly local: a purely national
	// story (President, presidential candidates) does NOT pass a county filter;
	// national figures appear only when co-tagged with someone local (the
	// article's regions then carry the local key too). Picking a ward doesn't
	// exclude the county's governor/senator, it only adds a level.
	const acceptableRegions = new Set<string>();
	if (county) acceptableRegions.add(`County:${county.name}`);
	// NB: positions.boundary stores the singular 'Constituency'.
	if (constituency) acceptableRegions.add(`Constituency:${constituency.seatName}`);
	if (ward) acceptableRegions.add(`Ward:${ward.seatName}`);
	const geoActive = !!(county || constituency || ward);
	// An article's own stored regions win when present (they cover EVERY tagged
	// person's seat, not just the primary author's); older rows and team posts
	// fall back to the author's seats.
	function matchesGeo(article: { regions: string[] | null; authorUserId: number | null }): boolean {
		if (!geoActive) return true;
		if (article.regions) return article.regions.some((key) => acceptableRegions.has(key));
		if (article.authorUserId === null) return false;
		const seats = seatsByUserId.get(article.authorUserId) ?? [];
		return seats.some((s) => acceptableRegions.has(`${s.boundary}:${s.region}`));
	}

	if (publicUserIds.length === 0) {
		return {
			articles: [],
			mentionSubject: null,
			total: 0,
			page,
			pageSize,
			tags: [],
			mentions: [],
			activeTag,
			activeMention,
			countySlug,
			constituencySlug,
			wardSlug,
			followedAuthors,
			activeAuthor
		};
	}

	// Team-authored (creatorId set), published, not-deactivated. Each gets its own
	// /news/[slug] article page.
	const postFilter = and(
		inArray(posts.subjectUserId, publicUserIds),
		isNotNull(posts.creatorId),
		isNotNull(posts.slug),
		eq(posts.medium, 'web'),
		eq(posts.public, true),
		isNull(posts.archivedAt),
		isNull(posts.deletedAt),
		isNull(users.deletedAt)
	);
	// Bounded: the page paginates in JS off this set, and the tag sidebar counts
	// over it, 200 newest team articles is far beyond what the UI surfaces.
	const postRows = await db.select({ post: posts, author: users }).from(posts).innerJoin(users, eq(posts.subjectUserId, users.id)).where(postFilter).orderBy(desc(posts.createdAt)).limit(200);

	const postIds = postRows.map((r) => r.post.id);
	// Team @mentions of OTHER leaders written inline in a team post's own body
	// (creatorId set on the tag, see MentionPicker/RichTextEditor).
	const inlineMentionRows = postIds.length
		? await db
				.select({ postId: tags.postId, slug: users.slug, firstName: users.firstName, otherNames: users.otherNames })
				.from(tags)
				.innerJoin(users, eq(tags.subjectUserId, users.id))
				.where(and(inArray(tags.postId, postIds), isNotNull(tags.creatorId), isNull(tags.deletedAt)))
		: [];
	const inlineMentionsByPostId = new Map<number, { slug: string; name: string }[]>();
	for (const r of inlineMentionRows) {
		if (!r.slug) continue;
		const list = inlineMentionsByPostId.get(r.postId) ?? [];
		list.push({ slug: r.slug, name: fullName(r) });
		inlineMentionsByPostId.set(r.postId, list);
	}

	// Aggregated mentions: system-authored (creatorId null), no local article page,
	// so they link out to where they were found (sourceUrl) instead. Tagged via the
	// same `tags` table, but with a null creatorId (the aggregation itself, not a
	// team member's own @mention), see scripts/lib/seed-news.ts for the dev-seeded
	// version of what a real scraping pipeline will produce.
	// With a geo filter active the window itself is region-scoped in SQL: a
	// low-coverage county gets its newest local articles however old, instead of
	// whatever survives of the site-wide window (which a burst of national
	// coverage can flush a quiet county out of entirely). Mentions all carry
	// regions (stored at ingest, backfilled once), so the jsonb containment
	// check is authoritative here; matchesGeo below stays for team posts.
	const geoCondition = geoActive
		? or(...[...acceptableRegions].map((key) => sql`${posts.regions} @> ${JSON.stringify([key])}::jsonb`))
		: undefined;
	const mentionPostFilter = and(
		isNull(posts.creatorId),
		eq(posts.medium, 'web'),
		eq(posts.public, true),
		isNull(posts.archivedAt),
		isNull(posts.deletedAt),
		isNull(tags.deletedAt),
		isNull(tags.creatorId),
		inArray(tags.subjectUserId, publicUserIds),
		geoCondition
	);
	// Bounded hard: daily ingestion grows this table forever, and this page only
	// ever shows a page-size slice. The mentions sidebar counts cover the 500
	// newest tag rows, which is a rolling few weeks of coverage, not all history.
	const mentionTagRows = await db
		.select({ post: posts, taggedUserId: tags.subjectUserId })
		.from(posts)
		.innerJoin(tags, eq(tags.postId, posts.id))
		.where(mentionPostFilter)
		.orderBy(desc(posts.createdAt))
		.limit(500);

	const mentionPostById = new Map<number, typeof posts.$inferSelect>();
	const taggedUserIdsByPostId = new Map<number, number[]>();
	for (const r of mentionTagRows) {
		mentionPostById.set(r.post.id, r.post);
		const list = taggedUserIdsByPostId.get(r.post.id) ?? [];
		list.push(r.taggedUserId);
		taggedUserIdsByPostId.set(r.post.id, list);
	}
	const taggedUserIds = [...new Set([...taggedUserIdsByPostId.values()].flat())];
	const taggedUserRows = taggedUserIds.length
		? await db.select({ id: users.id, slug: users.slug, firstName: users.firstName, otherNames: users.otherNames, photoUrl: users.photoUrl }).from(users).where(inArray(users.id, taggedUserIds))
		: [];
	const taggedUserById = new Map(taggedUserRows.map((u) => [u.id, u]));

	// Sidebar option lists. Every tag/mentioned leader across BOTH team posts and
	// aggregated mentions, with how many articles carry it, most-used first.
	const tagCounts = new Map<string, number>();
	const mentionCounts = new Map<string, { name: string; n: number }>();
	const bump = (slug: string, name: string) => mentionCounts.set(slug, { name, n: (mentionCounts.get(slug)?.n ?? 0) + 1 });
	for (const r of postRows) {
		for (const t of r.post.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
		for (const m of inlineMentionsByPostId.get(r.post.id) ?? []) bump(m.slug, m.name);
	}
	for (const [postId, post] of mentionPostById) {
		for (const t of post.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
		for (const uid of taggedUserIdsByPostId.get(postId) ?? []) {
			const u = taggedUserById.get(uid);
			if (u?.slug) bump(u.slug, fullName(u));
		}
	}
	const tagOptions = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n }));
	const mentionOptions = [...mentionCounts.entries()].sort((a, b) => b[1].n - a[1].n).map(([slug, v]) => ({ slug, name: v.name, n: v.n }));

	// Coverage tone over the last 30 days, per leader in the mentions sidebar:
	// one grouped query for everyone on the list rather than one per name, since
	// the sidebar can carry a hundred entries. Each row is a day's positive and
	// negative counts; the component plots their difference (net tone), which is
	// the only series that moves, two thirds of all coverage being neutral.
	const TONE_DAYS = 30;
	const toneRows = mentionOptions.length
		? await db
				.select({
					slug: users.slug,
					day: sql<string>`date(${posts.createdAt})`.as('day'),
					positive: sql<number>`count(*) filter (where ${posts.sentiment} = 'positive')`.mapWith(Number),
					negative: sql<number>`count(*) filter (where ${posts.sentiment} = 'negative')`.mapWith(Number)
				})
				.from(tags)
				.innerJoin(posts, eq(tags.postId, posts.id))
				.innerJoin(users, eq(tags.subjectUserId, users.id))
				.where(
					and(
						inArray(users.slug, mentionOptions.map((m) => m.slug)),
						isNull(tags.deletedAt),
						isNull(posts.deletedAt),
						isNotNull(posts.sentiment),
						sql`${posts.createdAt} > now() - interval '30 days'`
					)
				)
				.groupBy(users.slug, sql`date(${posts.createdAt})`)
		: [];

	// Dense day buckets (a day with no coverage is a real zero, not a gap), oldest
	// first, so the sparkline's x-axis is time rather than "days that happened".
	const dayKeys = Array.from({ length: TONE_DAYS }, (_, i) => {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - (TONE_DAYS - 1 - i));
		return d.toISOString().slice(0, 10);
	});
	const toneBySlug = new Map<string, number[]>();
	for (const r of toneRows) {
		if (!r.slug) continue;
		const series = toneBySlug.get(r.slug) ?? Array(TONE_DAYS).fill(0);
		const idx = dayKeys.indexOf(String(r.day).slice(0, 10));
		if (idx >= 0) series[idx] = r.positive - r.negative;
		toneBySlug.set(r.slug, series);
	}

	const articles: Article[] = [
		...postRows.map((r) => {
			const authorName = fullName(r.author);
			const excerpt = plainText(r.post.body);
			return {
				kind: 'post' as const,
				id: r.post.id,
				title: decodeHtmlEntities(r.post.title),
				excerpt: excerpt.length > 250 ? `${excerpt.slice(0, 250)}…` : excerpt,
				tags: r.post.tags ?? [],
				mentions: inlineMentionsByPostId.get(r.post.id) ?? [],
				authorName,
				authorInitials: initialsOf(authorName),
				authorPhotoUrl: r.author.photoUrl,
				authorUserId: r.author.id,
				authorOffice: officeByUserId.get(r.author.id)?.label ?? null,
				authorPath: leaderPath(r.author),
				href: `/news/${r.post.slug}`,
				external: false,
				sourceName: null,
				sentiment: null,
				createdAt: r.post.createdAt.toISOString(),
				regions: r.post.regions ?? null
			};
		}),
		...[...mentionPostById.entries()].map(([postId, post]) => {
			const taggedIds = taggedUserIdsByPostId.get(postId) ?? [];
			const taggedLeaders = taggedIds.map((uid) => taggedUserById.get(uid)).filter((u): u is NonNullable<typeof u> => !!u && !!u.slug);
			const [primary, ...rest] = taggedLeaders;
			const authorName = primary ? fullName(primary) : 'Unknown';
			const excerpt = plainText(post.body);
			return {
				kind: 'mention' as const,
				id: post.id,
				title: decodeHtmlEntities(post.title),
				excerpt: excerpt.length > 250 ? `${excerpt.slice(0, 250)}…` : excerpt,
				tags: post.tags ?? [],
				mentions: rest.map((u) => ({ slug: u.slug as string, name: fullName(u) })),
				authorName,
				authorInitials: initialsOf(authorName),
				authorPhotoUrl: primary?.photoUrl ?? null,
				authorUserId: primary?.id ?? null,
				authorOffice: primary ? (officeByUserId.get(primary.id)?.label ?? null) : null,
				authorPath: primary?.slug ? leaderPath({ slug: primary.slug }) : '#',
				href: post.sourceUrl ?? '#',
				external: true,
				sourceName: newsSourceName(post.sourceUrl, post.title),
				sentiment: post.sentiment,
				createdAt: post.createdAt.toISOString(),
				regions: post.regions ?? null
			};
		})
	].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

	const filtered = articles.filter((a) => {
		if (activeTag && !a.tags.includes(activeTag)) return false;
		if (activeMention) {
			// Matches the person's own authored articles (team post or the primary
			// subject of an aggregated mention) as well as inline @mentions in
			// someone else's post, "news about this person", not just "news that
			// name-drops them".
			const matchesPrimary = a.authorPath === `/${activeMention}`;
			const matchesTagged = a.mentions.some((m) => m.slug === activeMention);
			if (!matchesPrimary && !matchesTagged) return false;
		}
		if (!matchesGeo(a)) return false;
		if (activeAuthor && a.authorUserId !== activeAuthor) return false;
		return true;
	});
	const total = filtered.length;
	const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

	// Who a ?mention= view is about, for the page title and the link-preview
	// (Open Graph) tags. This URL is the one every shared WhatsApp brief ends
	// with, so it has to unfurl as that person's news rather than the generic
	// homepage. Only queried when the filter is actually on.
	let mentionSubject: { name: string; office: string | null; photoUrl: string | null } | null = null;
	if (activeMention) {
		const [row] = await db
			.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames, photoUrl: users.photoUrl })
			.from(users)
			.where(and(eq(users.slug, activeMention), isNull(users.deletedAt)));
		if (row) {
			mentionSubject = {
				name: fullName(row),
				office: officeByUserId.get(row.id)?.label ?? null,
				photoUrl: row.photoUrl
			};
		}
	}

	return {
		articles: paged,
		mentionSubject,
		total,
		page,
		pageSize,
		tags: tagOptions,
		mentions: mentionOptions.map((m) => ({ ...m, tone: toneBySlug.get(m.slug) ?? null })),
		activeTag,
		activeMention,
		countySlug,
		constituencySlug,
		wardSlug,
		followedAuthors,
		activeAuthor
	};
};
