// The public FAQ, read from platform_faqs rather than hardcoded in the page.
// Same rows the site-wide Ask box answers from (platformAsk.ts) and the same
// ones admins edit at /dashboard/admin/knowledge — so what a citizen reads here
// and what the AI tells them can't drift apart.
import { asc, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { platformFaqs } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db
		.select({
			section: platformFaqs.section,
			question: platformFaqs.question,
			answer: platformFaqs.answer
		})
		.from(platformFaqs)
		.where(isNull(platformFaqs.deletedAt))
		.orderBy(asc(platformFaqs.sortOrder), asc(platformFaqs.id));

	// Grouped in first-seen order, so a section's position follows its rows'
	// own ordering rather than needing a separate section-order column.
	const bySection = new Map<string, { question: string; answer: string }[]>();
	for (const row of rows) {
		const list = bySection.get(row.section) ?? [];
		list.push({ question: row.question, answer: row.answer });
		bySection.set(row.section, list);
	}

	return { sections: [...bySection.entries()].map(([title, items]) => ({ title, items })) };
};
