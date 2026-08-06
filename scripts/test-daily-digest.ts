// Dry-runs the daily brief against real data: same queries sendDailyDigests uses,
// but it PRINTS each brief instead of emailing anyone. Use it to see what a given
// morning would have sent before trusting the scheduler with it.
//
// Mirrors digest.ts rather than importing it ($env/dynamic/private only resolves
// inside SvelteKit's runtime). Keep the two in step if the brief changes.
//
// Usage: bun run scripts/test-daily-digest.ts [--hours 24]
import { parseArgs } from 'node:util';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { conversations, managers, messages, posts, tags, users } from '../src/lib/server/db/schema';
import { user as authUsers } from '../src/lib/server/db/auth.schema';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

const { values } = parseArgs({ options: { hours: { type: 'string', default: '24' } } });
const since = new Date(Date.now() - Number(values.hours) * 60 * 60 * 1000);

const mentionRows = await db
	.select({
		subjectUserId: tags.subjectUserId,
		mentions: sql<number>`count(*)`.mapWith(Number),
		positive: sql<number>`count(*) filter (where ${posts.sentiment} = 'positive')`.mapWith(Number),
		negative: sql<number>`count(*) filter (where ${posts.sentiment} = 'negative')`.mapWith(Number)
	})
	.from(tags)
	.innerJoin(posts, eq(tags.postId, posts.id))
	.where(and(isNull(tags.deletedAt), isNull(posts.deletedAt), isNull(posts.creatorId), gte(tags.createdAt, since)))
	.groupBy(tags.subjectUserId);

const inboxRows = await db
	.select({ subjectUserId: conversations.scopeId, unanswered: sql<number>`count(*)`.mapWith(Number) })
	.from(messages)
	.innerJoin(conversations, eq(messages.conversationId, conversations.id))
	.where(
		and(
			eq(conversations.scope, 'leader'),
			eq(messages.sender, 'follower'),
			eq(messages.target, 'manager'),
			sql`not exists (select 1 from ${messages} reply where reply.conversation_id = ${messages.conversationId}
				and reply.created_at > ${messages.createdAt} and reply.sender in ('leader','manager','ambassador'))`
		)
	)
	.groupBy(conversations.scopeId);

const ids = [...new Set([...mentionRows.map((r) => r.subjectUserId), ...inboxRows.map((r) => r.subjectUserId).filter((x): x is number => x !== null)])];
console.log(`window: last ${values.hours}h  |  leaders with activity: ${ids.length}\n`);
if (ids.length === 0) {
	console.log('Nothing would be sent: no new mentions and no unanswered questions.');
	await client.end();
	process.exit(0);
}

const people = await db.select({ id: users.id, firstName: users.firstName, otherNames: users.otherNames, slug: users.slug }).from(users).where(inArray(users.id, ids));
const nameById = new Map(people.map((p) => [p.id, `${p.firstName} ${p.otherNames}`.trim()]));

let totalRecipients = 0;
for (const id of ids) {
	const m = mentionRows.find((r) => r.subjectUserId === id);
	const inbox = inboxRows.find((r) => r.subjectUserId === id);
	const heads = m
		? await db
				.select({ title: posts.title })
				.from(tags)
				.innerJoin(posts, eq(tags.postId, posts.id))
				.where(and(eq(tags.subjectUserId, id), isNull(tags.deletedAt), isNull(posts.deletedAt), isNull(posts.creatorId), gte(tags.createdAt, since)))
				.orderBy(desc(posts.createdAt))
				.limit(3)
		: [];
	const team = await db
		.select({ userId: managers.userId })
		.from(managers)
		.where(and(eq(managers.subjectUserId, id), eq(managers.isActive, true), isNull(managers.deletedAt)));
	// Same verified-email rule digest.ts applies: seeded accounts carry addresses
	// on a domain that doesn't exist, so counting them would overstate the send.
	const targets = [...new Set([...team.map((t) => t.userId), id])];
	const reachable = await db
		.select({ id: users.id })
		.from(users)
		.innerJoin(authUsers, eq(users.authUserId, authUsers.id))
		.where(and(inArray(users.id, targets), isNull(users.deletedAt), eq(authUsers.emailVerified, true)));
	const recipients = reachable.length;
	totalRecipients += recipients;

	const crisis = (m?.mentions ?? 0) >= 3 || (m?.negative ?? 0) >= 2;
	console.log(`── ${nameById.get(id) ?? id}${crisis ? '   [crisis]' : ''}  -> ${recipients} recipient(s)`);
	if (m) console.log(`   ${m.mentions} new mentions (${m.positive} positive, ${m.negative} negative)`);
	for (const h of heads) console.log(`   - ${h.title.slice(0, 78)}`);
	if (inbox) console.log(`   ${inbox.unanswered} citizen question(s) waiting`);
	console.log();
}
console.log(`Would notify ${totalRecipients} recipient(s) across ${ids.length} leaders (verified emails only).`);
await client.end();
