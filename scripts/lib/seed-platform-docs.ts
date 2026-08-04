// Seeds the civics/platform corpus from src/lib/data/platformDocs.json into
// `platform_documents` — the citizen, ambassador, and leaders manuals, which the
// site-wide Ask box answers "how does vote.ke work" questions from.
//
// The JSON is generated from the manuals in Drive with the unshipped ([ ]) items
// stripped out, so the assistant only ever describes features that actually
// exist. Regenerate it when a manual changes, then reseed.
//
// Idempotent and additive, matching seed-platform-faqs: an existing title is
// left untouched (admins edit these at /dashboard/admin/knowledge and a reseed
// must not clobber that), only new titles are inserted.
import { and, eq, isNull } from 'drizzle-orm';
import { platformDocuments } from '../../src/lib/server/db/schema';
import type { AnyDb } from './names';
import docsData from '../../src/lib/data/platformDocs.json';

type DocRow = { title: string; body: string; keywords: string; sourceUrl: string | null };

export async function seedPlatformDocs(db: AnyDb) {
	const rows = docsData as DocRow[];
	if (rows.length === 0) {
		console.log('[platform-docs] no rows in platformDocs.json, skipping');
		return;
	}

	let seeded = 0;
	let skipped = 0;

	for (const row of rows) {
		const [existing] = await db
			.select({ id: platformDocuments.id })
			.from(platformDocuments)
			.where(and(eq(platformDocuments.title, row.title), isNull(platformDocuments.deletedAt)));
		if (existing) {
			skipped++;
			continue;
		}
		await db.insert(platformDocuments).values({
			title: row.title,
			body: row.body,
			keywords: row.keywords,
			sourceUrl: row.sourceUrl
		});
		seeded++;
	}

	console.log(`[platform-docs] ${seeded} seeded, ${skipped} already present`);
}
