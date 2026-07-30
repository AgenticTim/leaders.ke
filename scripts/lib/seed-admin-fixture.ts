// Dev-only test fixture: a fully-populated demo leader, "Example Leader" (/example-leader),
// that the platform admin MANAGES — so every profile + dashboard feature (bio, contacts,
// education/professional experience, a multi-seat Track Record, a manifesto with a delivery
// scorecard, web posts + a news mention, citizen reviews both public and flagged, donations,
// a manager team and a follower) can be exercised end-to-end from the admin login.
//
// Design:
// - "Example Leader" is its OWN loginable user and owns the profile. The admin account
//   stays a clean admin; it just gets a `managers` row on the profile, which is what the
//   dashboard role switcher reads ("Managing: Example Leader") — ownership alone never
//   surfaces there.
// - The profile page itself is public regardless of verifiedAt (every non-deactivated
//   profile is; see publicProfile.ts) — verifiedAt only gates whether a leaders row
//   surfaces in a LISTING (directory grids, seat hubs, era browsing). Its two leaders
//   rows (former Wajir Governor, former Wajir Senator) ARE verified, on purpose,
//   so those listings have a verified-badge example to exercise. The 2027 campaign
//   stays UNVERIFIED: that keeps it out of every campaign-gated surface (the ballot,
//   candidate lookups, seat-hub "contesting" lists, news ingestion), so the demo run
//   never pollutes the live 2027 race even though the held-office history is real.
// - The dummy leader/citizens/manager all get real logins (password DUMMY_PASSWORD, emails
//   logged) so their side of the review/team flows can be tested too.
//
// Fully idempotent: every insert guards on an existing row, so re-running (a partial
// `--admin-fixture` phase or a full reseed) backfills without duplicating.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
	ambassadors,
	campaigns,
	citizenFeedback,
	contacts,
	donations,
	experience,
	followers,
	leaders,
	managers,
	mobilizationEvents,
	pillars,
	pledges,
	positions,
	posts,
	reviews,
	subscriptions,
	tags,
	users,
	wallets
} from '../../src/lib/server/db/schema';
import { user as authUsers, account } from '../../src/lib/server/db/auth.schema';
import { slugify, splitName, type AnyDb } from './names';

const LEADER_NAME = 'Example Leader';
const LEADER_SLUG = 'example-leader';
const LEADER_EMAIL = 'example@leaders.ke';
const DUMMY_PASSWORD = 'example.27'; // dev-only login for the seeded leader/citizens/manager
const BIO =
	'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
	'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure ' +
	'dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
const LOREM_LINE =
	'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

// This user is created AFTER the seed pipeline's own photo-assignment phases
// (seed-photos.ts) have already run, so it can never pick up a shipped photo the
// way a real scraped person does — set it directly here instead, whenever the
// git-tracked file exists, so a full reseed always leaves the fixture with one.
const PHOTO_PATH = join(import.meta.dir, '..', '..', 'static', 'leaders', `${LEADER_SLUG}.jpg`);

/** Position id for a (title, region) seat, or null if the positions phase hasn't run. */
async function positionId(db: AnyDb, title: string, region: string): Promise<number | null> {
	const [p] = await db
		.select({ id: positions.id })
		.from(positions)
		.where(and(eq(positions.title, title), eq(positions.region, region), isNull(positions.deletedAt)));
	return p?.id ?? null;
}

/** Insert-or-find a leaders row for this person+seat+status, verified on purpose
 * (see the module comment) so it exercises a verified-badge/listing example. */
async function ensureLeader(
	db: AnyDb,
	userId: number,
	posId: number,
	status: 'former' | 'current' | 'aspirant',
	startAt: Date,
	endAt: Date | null,
	description: string | null
): Promise<number> {
	const [existing] = await db
		.select({ id: leaders.id })
		.from(leaders)
		.where(and(eq(leaders.userId, userId), eq(leaders.positionId, posId), eq(leaders.status, status), isNull(leaders.deletedAt)));
	if (existing) {
		// Backfills a verifiedAt onto a row created before this fixture was verified.
		await db.update(leaders).set({ verifiedAt: new Date() }).where(and(eq(leaders.id, existing.id), isNull(leaders.verifiedAt)));
		return existing.id;
	}
	const [row] = await db
		.insert(leaders)
		.values({ userId, positionId: posId, status, startAt, endAt, verifiedAt: new Date(), description })
		.returning({ id: leaders.id });
	return row.id;
}

/** Insert-or-find a real (loginable) dummy domain user; sets a slug when given (the leader). */
async function getOrCreateDummyUser(db: AnyDb, name: string, email: string, slug?: string): Promise<number> {
	const [existingAuth] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email));
	if (existingAuth) {
		const [du] = await db.select({ id: users.id }).from(users).where(eq(users.authUserId, existingAuth.id));
		if (du) return du.id;
	}
	const authId = randomUUID();
	await db.insert(authUsers).values({ id: authId, name, email, emailVerified: true });
	await db.insert(account).values({
		id: randomUUID(),
		accountId: authId,
		providerId: 'credential',
		userId: authId,
		password: await hashPassword(DUMMY_PASSWORD)
	});
	const { firstName, otherNames } = splitName(name);
	const [du] = await db
		.insert(users)
		.values({ authUserId: authId, firstName, otherNames, slug: slug ?? null, verified: { email: true, sms: true, whatsapp: false } })
		.returning({ id: users.id });
	return du.id;
}

export async function seedAdminFixture(db: AnyDb) {
	const email = process.env.ADMIN_EMAIL;
	if (!email) {
		console.warn('[admin-fixture] ADMIN_EMAIL not set, skipping');
		return;
	}
	const [adminAuth] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email));
	const [admin] = adminAuth ? await db.select({ id: users.id }).from(users).where(eq(users.authUserId, adminAuth.id)) : [];
	if (!admin) {
		console.warn('[admin-fixture] admin account not found (run the system-user phase first), skipping');
		return;
	}

	const govId = await positionId(db, 'Governor', 'Wajir');
	const senId = await positionId(db, 'Senator', 'Wajir');
	if (!govId || !senId) {
		console.warn('[admin-fixture] Wajir Governor/Senator positions missing (run the positions phase first), skipping');
		return;
	}

	// The demo leader is its own account (so it reads as "Example Leader" everywhere,
	// not the admin's name), with a public identity (bio + reserved-ish slug).
	const leaderUserId = await getOrCreateDummyUser(db, LEADER_NAME, LEADER_EMAIL, LEADER_SLUG);
	await db
		.update(users)
		.set({
			bio: BIO,
			address: 'City Hall, Wajir',
			socials: { twitter: 'https://twitter.com/leaders_ke' },
			...(existsSync(PHOTO_PATH) ? { photoUrl: `/leaders/${LEADER_SLUG}.jpg` } : {})
		})
		.where(eq(users.id, leaderUserId));

	// Seats. Held Wajir Governor and Wajir Senator in prior regimes (leaders rows,
	// verified — see module comment); vying for Wajir Governor again in 2027 — that
	// run is a campaign, not a leaders row (see the manifesto block below), and stays
	// unverified so the demo run itself never surfaces on any campaign-gated surface.
	await ensureLeader(db, leaderUserId, govId, 'former', new Date('2003-08-27T00:00:00+03:00'), new Date('2007-08-08T00:00:00+03:00'), null);
	await ensureLeader(db, leaderUserId, senId, 'former', new Date('2007-08-08T00:00:00+03:00'), new Date('2012-08-09T00:00:00+03:00'), null);

	// Contacts (marked verified so the "Verified" chip renders on the profile).
	for (const c of [
		{ channel: 'email' as const, value: 'example.leader.contact@leaders.ke' },
		{ channel: 'sms' as const, value: '254700000001' }
	]) {
		await db.insert(contacts).values({ userId: leaderUserId, channel: c.channel, value: c.value, verifiedAt: new Date() }).onConflictDoNothing();
	}

	// Education + professional history belongs to the person (spans every term/run).
	const expRows = [
		{ type: 'education' as const, title: 'Bachelor of Laws (LLB)', institution: 'University of Wajir', from: '2004-09-01', to: '2008-06-01' },
		{ type: 'education' as const, title: 'Master of Public Policy', institution: 'Strathmore University', from: '2009-09-01', to: '2011-06-01' },
		{ type: 'professional' as const, title: 'Managing Partner', institution: 'Lorem & Ipsum Advocates', from: '2011-07-01', to: '2013-08-01' },
		{ type: 'professional' as const, title: 'Board Chairperson', institution: 'Dolor Sit Foundation', from: '2018-01-01', to: null }
	];
	for (const e of expRows) {
		const [ex] = await db
			.select({ id: experience.id })
			.from(experience)
			.where(
				and(
					eq(experience.subjectUserId, leaderUserId),
					eq(experience.type, e.type),
					eq(experience.title, e.title),
					eq(experience.institution, e.institution)
				)
			);
		if (ex) continue;
		await db.insert(experience).values({
			subjectUserId: leaderUserId,
			type: e.type,
			title: e.title,
			institution: e.institution,
			description: LOREM_LINE,
			startAt: new Date(`${e.from}T00:00:00+03:00`),
			endAt: e.to ? new Date(`${e.to}T00:00:00+03:00`) : null
		});
	}

	// The 2027 run: a person-anchored campaign (no leaders row), verifiedAt left null so
	// the whole demo profile stays admin-only. Manifesto pillars hang off it below.
	let [campaign] = await db
		.select({ id: campaigns.id })
		.from(campaigns)
		.where(and(eq(campaigns.subjectUserId, leaderUserId), eq(campaigns.cycleYear, 2027), isNull(campaigns.parentCampaignId), isNull(campaigns.deletedAt)));
	if (!campaign) {
		[campaign] = await db
			.insert(campaigns)
			.values({ creatorId: leaderUserId, subjectUserId: leaderUserId, leaderId: null, positionId: govId, cycleYear: 2027, title: 'Example Campaign: Wajir Forward 2027', description: BIO })
			.returning({ id: campaigns.id });
	}
	const pillarRows = [
		{ title: 'Affordable Healthcare', status: 'delivered' as const },
		{ title: 'Clean Water for All', status: 'delivered' as const },
		{ title: 'Youth Employment', status: 'delivered' as const },
		{ title: 'Better Roads', status: 'delivered' as const },
		{ title: 'Digital Governance', status: 'in_progress' as const }
	];
	for (const [i, p] of pillarRows.entries()) {
		const [ex] = await db
			.select({ id: pillars.id })
			.from(pillars)
			.where(and(eq(pillars.campaignId, campaign.id), eq(pillars.title, p.title), isNull(pillars.deletedAt)));
		if (ex) continue;
		await db.insert(pillars).values({
			campaignId: campaign.id,
			title: p.title,
			summary: LOREM_LINE,
			deliveryStatus: p.status,
			evidence: p.status === 'delivered' ? LOREM_LINE : null,
			sortOrder: i
		});
	}

	// Web posts on the leading term: the newest drives the profile's "Latest post"
	// pointer, and one is tagged to the leader so the "In the news" block populates.
	const postRows = [
		{ title: 'My plan for Wajir water', body: BIO, news: false },
		{ title: 'Example Leader tables affordable-housing bill', body: BIO, news: true }
	];
	for (const pr of postRows) {
		let [post] = await db
			.select({ id: posts.id })
			.from(posts)
			.where(and(eq(posts.subjectUserId, leaderUserId), eq(posts.title, pr.title), isNull(posts.deletedAt)));
		if (!post) {
			[post] = await db
				.insert(posts)
				.values({
					creatorId: leaderUserId,
					subjectUserId: leaderUserId,
					campaignId: campaign.id,
					title: pr.title,
					slug: slugify(pr.title),
					body: pr.body,
					aiSummary: LOREM_LINE,
					medium: 'web',
					approved: true,
					public: true
				})
				.returning({ id: posts.id });
		}
		if (pr.news) {
			const [tag] = await db
				.select({ id: tags.id })
				.from(tags)
				.where(and(eq(tags.postId, post.id), eq(tags.subjectUserId, leaderUserId), isNull(tags.deletedAt)));
			if (!tag) await db.insert(tags).values({ creatorId: leaderUserId, postId: post.id, subjectUserId: leaderUserId });
		}
	}

	// Dominate-tier subscription: exercises every Dominate-gated dashboard feature
	// (Competitors tab sentiment breakdown, voter heatmap, news source control)
	// from the demo profile, the same way the fixture already exercises verified
	// badges and flagged reviews. Self-paid (payerId = leaderUserId), matching a
	// candidate who subscribes for themselves.
	const [existingSub] = await db
		.select({ id: subscriptions.id })
		.from(subscriptions)
		.where(and(eq(subscriptions.subjectUserId, leaderUserId), eq(subscriptions.status, 'active')));
	if (!existingSub) {
		await db.insert(subscriptions).values({
			subjectUserId: leaderUserId,
			payerId: leaderUserId,
			tier: 'dominate',
			billingCycle: 'annual',
			amount: 500_000,
			paidAt: new Date(),
			status: 'active',
			startAt: new Date(),
			endsAt: new Date('2027-12-31T00:00:00+03:00'),
			paymentMethod: 'mpesa',
			paymentReference: `DEMO-${LEADER_SLUG}`
		});
	}

	// A funded wallet so the demo profile's AI Chat answers citizens immediately
	// (the credit-gated path in the Ask box), rather than routing every question
	// to the team as an uncredited profile would.
	await db
		.insert(wallets)
		.values({ subjectUserId: leaderUserId, balance: 100 })
		.onConflictDoNothing({ target: wallets.subjectUserId });

	// Aggregated news coverage (the same shape newsIngest.ts produces — a null-
	// creator post + a tags row per mentioned person) so the Competitors tab's
	// Sentiment Intelligence Suite has a real positive/neutral/negative mix to
	// chart for this demo profile instead of an empty "No coverage yet" bar.
	const coverageRows = [
		{ title: 'Example Leader unveils Wajir water pipeline progress', sentiment: 'positive' as const },
		{ title: 'Wajir residents praise Example Leader housing bill push', sentiment: 'positive' as const },
		{ title: 'Example Leader tours drought-hit wards, pledges relief funds', sentiment: 'positive' as const },
		{ title: 'Example Leader attends county budget review meeting', sentiment: 'neutral' as const },
		{ title: 'Example Leader responds to questions on stalled road project', sentiment: 'neutral' as const },
		{ title: 'Critics accuse Example Leader of slow pace on water pipeline', sentiment: 'negative' as const }
	];
	for (const [i, cr] of coverageRows.entries()) {
		const sourceUrl = `https://example.com/demo-coverage/${LEADER_SLUG}-${i}`;
		let [post] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.sourceUrl, sourceUrl), isNull(posts.deletedAt)));
		if (!post) {
			[post] = await db
				.insert(posts)
				.values({
					subjectUserId: leaderUserId,
					title: cr.title,
					body: LOREM_LINE,
					sourceUrl,
					medium: 'web',
					sentiment: cr.sentiment,
					approved: true,
					public: true
				})
				.onConflictDoNothing({ target: posts.sourceUrl })
				.returning({ id: posts.id });
		}
		if (!post) continue;
		const [tag] = await db
			.select({ id: tags.id })
			.from(tags)
			.where(and(eq(tags.postId, post.id), eq(tags.subjectUserId, leaderUserId), isNull(tags.deletedAt)));
		if (!tag) await db.insert(tags).values({ postId: post.id, subjectUserId: leaderUserId });
	}

	// Reviews: one self-review (public), one citizen public review, one flagged/hidden
	// (spam) — so the public review list AND the flagged-count moderation UI have data.
	const janeId = await getOrCreateDummyUser(db, 'Jane Wanjiru', 'jane.citizen@leaders.ke');
	const johnId = await getOrCreateDummyUser(db, 'John Otieno', 'john.citizen@leaders.ke');
	const reviewRows = [
		{ reviewerId: leaderUserId, rating: 5, flagReason: null as 'spam' | null, flagged: false },
		{ reviewerId: janeId, rating: 4, flagReason: null as 'spam' | null, flagged: false },
		{ reviewerId: johnId, rating: 1, flagReason: 'spam' as 'spam' | null, flagged: true }
	];
	for (const r of reviewRows) {
		const [ex] = await db
			.select({ id: reviews.id })
			.from(reviews)
			.where(and(eq(reviews.subjectId, leaderUserId), eq(reviews.userId, r.reviewerId), isNull(reviews.deletedAt)));
		if (ex) continue;
		await db.insert(reviews).values({
			userId: r.reviewerId,
			subjectId: leaderUserId,
			public: true,
			rating: r.rating,
			message: LOREM_LINE,
			flagReason: r.flagReason,
			flaggedAt: r.flagged ? new Date() : null
		});
	}

	// Donations on the leading term (confirmed, for the fundraising ledger).
	const donationRows = [
		{ donorName: 'Jane Wanjiru', phoneNumber: '254700000002', amount: 5000, reference: 'DEMO-DON-1' },
		{ donorName: 'Anonymous', phoneNumber: null, amount: 1500, reference: 'DEMO-DON-2' }
	];
	for (const d of donationRows) {
		const [ex] = await db
			.select({ id: donations.id })
			.from(donations)
			.where(and(eq(donations.campaignId, campaign.id), eq(donations.reference, d.reference), isNull(donations.deletedAt)));
		if (ex) continue;
		await db.insert(donations).values({
			campaignId: campaign.id,
			donorName: d.donorName,
			phoneNumber: d.phoneNumber,
			amount: d.amount,
			status: 'confirmed',
			reference: d.reference
		});
	}

	// Pledges spread across a few counties (real names, matching $lib/data/geo.ts)
	// so the Followers tab's Dominate-only voter heatmap has something to draw —
	// otherwise that graphical feature is invisible on this fixture until a real
	// citizen pledges, defeating the point of an "exercise every feature" demo.
	const aminaId = await getOrCreateDummyUser(db, 'Amina Hassan', 'amina.citizen@leaders.ke');
	const peterId = await getOrCreateDummyUser(db, 'Peter Kones', 'peter.citizen@leaders.ke');
	// Jane and John are attributed to Amina (the ambassador, seeded below) so the
	// mobilize Pledges tab has recruited rows to show; Amina and Peter self-pledge.
	const pledgerCounties: [number, string, number | null][] = [
		[janeId, 'Nairobi', aminaId],
		[johnId, 'Kiambu', aminaId],
		[aminaId, 'Mombasa', null],
		[peterId, 'Kisumu', null]
	];
	for (const [userId, pledgeCounty, addedBy] of pledgerCounties) {
		await db.update(users).set({ county: pledgeCounty }).where(eq(users.id, userId));
		await db.insert(pledges).values({ userId, campaignId: campaign.id, addedBy }).onConflictDoNothing();
	}

	// Team: the ADMIN manages this profile (so it shows in the admin's role switcher as
	// "Managing: Example Leader"), plus a second manager for the team flow.
	const maryId = await getOrCreateDummyUser(db, 'Mary Kamau', 'mary.manager@leaders.ke');
	for (const m of [
		{ userId: admin.id, title: 'Platform Admin (tester)' },
		{ userId: maryId, title: 'Campaign Manager' }
	]) {
		const [ex] = await db
			.select({ id: managers.id })
			.from(managers)
			.where(and(eq(managers.userId, m.userId), eq(managers.subjectUserId, leaderUserId), isNull(managers.deletedAt)));
		if (ex) continue;
		await db.insert(managers).values({
			userId: m.userId,
			subjectUserId: leaderUserId,
			roles: { admin: true, title: m.title },
			isActive: true
		});
	}

	// Mobilization (TODO #17): Amina is also an ambassador, so the demo exercises
	// the field-work flow end to end — events (one manager-confirmed, one still
	// awaiting, one upcoming) and citizen feedback across sentiments. Idempotent by
	// title/message so a re-run doesn't stack duplicates.
	const [existingAmb] = await db
		.select({ id: ambassadors.id })
		.from(ambassadors)
		.where(and(eq(ambassadors.userId, aminaId), eq(ambassadors.subjectUserId, leaderUserId), isNull(ambassadors.deletedAt)));
	if (!existingAmb) {
		await db.insert(ambassadors).values({ userId: aminaId, subjectUserId: leaderUserId, campaignId: campaign.id, roles: {}, isActive: true });
	}

	const now = Date.now();
	const day = 24 * 60 * 60 * 1000;
	const demoEvents = [
		{ title: 'Wajir town hall meeting', description: 'Met elders on water access and bursaries.', county: 'Wajir', ward: null, scheduledFor: new Date(now - 7 * day), turnout: 85, status: 'held' as const, confirmed: true },
		{ title: 'Eldas ward door-to-door', description: 'Household visits across three villages.', county: 'Wajir', ward: 'Eldas', scheduledFor: new Date(now - 2 * day), turnout: 40, status: 'held' as const, confirmed: false },
		{ title: 'Youth mobilization rally', description: 'Voter-registration drive for first-time voters.', county: 'Wajir', ward: null, scheduledFor: new Date(now + 10 * day), turnout: null, status: 'planned' as const, confirmed: false }
	];
	const eventIdByTitle = new Map<string, number>();
	for (const e of demoEvents) {
		const [ex] = await db
			.select({ id: mobilizationEvents.id })
			.from(mobilizationEvents)
			.where(and(eq(mobilizationEvents.subjectUserId, leaderUserId), eq(mobilizationEvents.title, e.title), isNull(mobilizationEvents.deletedAt)));
		if (ex) {
			eventIdByTitle.set(e.title, ex.id);
			continue;
		}
		const [row] = await db
			.insert(mobilizationEvents)
			.values({
				subjectUserId: leaderUserId,
				ambassadorUserId: aminaId,
				title: e.title,
				description: e.description,
				county: e.county,
				ward: e.ward,
				scheduledFor: e.scheduledFor,
				status: e.status,
				turnout: e.turnout,
				confirmedBy: e.confirmed ? admin.id : null,
				confirmedAt: e.confirmed ? new Date(now - 6 * day) : null
			})
			.returning({ id: mobilizationEvents.id });
		eventIdByTitle.set(e.title, row.id);
	}

	const demoFeedback = [
		{ citizenName: 'Halima Abdi', county: 'Wajir', ward: 'Eldas', sentiment: 'positive' as const, message: 'Happy with the new borehole promise, wants a timeline.', event: 'Wajir town hall meeting' },
		{ citizenName: 'Ibrahim Noor', county: 'Wajir', ward: null, sentiment: 'negative' as const, message: 'Frustrated that the last bursary list left out his ward.', event: 'Eldas ward door-to-door' },
		{ citizenName: null, county: 'Wajir', ward: null, sentiment: 'neutral' as const, message: 'Undecided, waiting to compare all candidates.', event: null }
	];
	for (const f of demoFeedback) {
		const [ex] = await db
			.select({ id: citizenFeedback.id })
			.from(citizenFeedback)
			.where(and(eq(citizenFeedback.subjectUserId, leaderUserId), eq(citizenFeedback.message, f.message), isNull(citizenFeedback.deletedAt)));
		if (ex) continue;
		await db.insert(citizenFeedback).values({
			subjectUserId: leaderUserId,
			collectedByUserId: aminaId,
			eventId: f.event ? (eventIdByTitle.get(f.event) ?? null) : null,
			citizenName: f.citizenName,
			county: f.county,
			ward: f.ward,
			sentiment: f.sentiment,
			message: f.message
		});
	}

	// One follower (the leader follows their own leading term).
	const [existingFollow] = await db
		.select({ id: followers.id })
		.from(followers)
		.where(and(eq(followers.userId, leaderUserId), eq(followers.digest, 'leader'), eq(followers.digestId, leaderUserId), isNull(followers.deletedAt)));
	if (!existingFollow) {
		await db
			.insert(followers)
			.values({ userId: leaderUserId, digest: 'leader', digestId: leaderUserId, county: 'Wajir', email: true, sms: false, whatsapp: false });
	}

	// A few CONFIRMED contact-follows (email + phone) so the Broadcasts tab has
	// reachable recipients across channels to demo against — guest follows are
	// unconfirmed until a round-trip, which would leave the broadcast audience at 0.
	const demoFollowers = [
		{ name: 'Halima Abdi', emailAddress: 'halima.follower@leaders.ke', phoneNumber: '254712000001', ward: 'Eldas' },
		{ name: 'Ibrahim Noor', emailAddress: 'ibrahim.follower@leaders.ke', phoneNumber: '254712000002', ward: 'Wajir Township' },
		{ name: 'Fatuma Ali', emailAddress: 'fatuma.follower@leaders.ke', phoneNumber: '254712000003', ward: 'Tarbaj' }
	];
	for (const f of demoFollowers) {
		const [ex] = await db
			.select({ id: followers.id })
			.from(followers)
			.where(and(eq(followers.digest, 'leader'), eq(followers.digestId, leaderUserId), eq(followers.emailAddress, f.emailAddress), isNull(followers.deletedAt)));
		if (ex) continue;
		await db.insert(followers).values({
			name: f.name,
			emailAddress: f.emailAddress,
			phoneNumber: f.phoneNumber,
			county: 'Wajir',
			ward: f.ward,
			digest: 'leader',
			digestId: leaderUserId,
			email: true,
			sms: true,
			whatsapp: true,
			confirmedAt: new Date()
		});
	}

	console.log(`[admin-fixture] seeded demo leader /${LEADER_SLUG} (admin-managed, verified profile, unverified 2027 campaign) + citizens/manager (login pw: ${DUMMY_PASSWORD})`);
}
