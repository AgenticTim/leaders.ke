// Seeds the public FAQ from src/lib/data/platformFaqs.json into `platform_faqs`,
// the same rows the /faq page renders and the site-wide Ask box answers from.
// Idempotent and additive: an existing question is left untouched (admins edit
// answers at /dashboard/admin/knowledge, and a reseed must never clobber that),
// only genuinely new questions are inserted.
import { and, eq, isNull } from 'drizzle-orm';
import { platformFaqs } from '../../src/lib/server/db/schema';
import type { AnyDb } from './names';
import faqData from '../../src/lib/data/platformFaqs.json';

type FaqSection = { section: string; items: { question: string; answer: string }[] };

export async function seedPlatformFaqs(db: AnyDb) {
	const sections = faqData as FaqSection[];
	if (sections.length === 0) {
		console.log('[platform-faqs] no rows in platformFaqs.json, skipping');
		return;
	}

	let seeded = 0;
	let skipped = 0;

	for (const section of sections) {
		// sortOrder is the JSON's own order within a section, so the page keeps
		// the deliberate sequence the copy was written in.
		for (const [index, item] of section.items.entries()) {
			const [existing] = await db
				.select({ id: platformFaqs.id })
				.from(platformFaqs)
				.where(and(eq(platformFaqs.question, item.question), isNull(platformFaqs.deletedAt)));
			if (existing) {
				skipped++;
				continue;
			}
			await db.insert(platformFaqs).values({
				section: section.section,
				question: item.question,
				answer: item.answer,
				sortOrder: index
			});
			seeded++;
		}
	}

	console.log(`[platform-faqs] ${seeded} seeded, ${skipped} already present`);
}
