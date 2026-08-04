// Platform knowledge admin (plans/10-platform-wide-ai-chat.md): everything the
// site-wide Ask box answers platform/civics questions from, in one place.
//
//   Documents: curated reference text (registration how-tos, election dates,
//     the citizen/ambassador manuals). Each carries its own keyword list, since
//     platformAsk.ts keeps every source keyword-gated so one question never
//     drags the whole corpus into a billed prompt.
//   FAQ: the same Q&A the public /faq page renders. Editing an answer here
//     changes both what a citizen reads there and what the AI says, which is
//     the point of it living in the database rather than in the page.
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { platformDocuments, platformFaqs } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { adminActionFailed } from '$lib/server/notifications';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	const docs = await db
		.select()
		.from(platformDocuments)
		.where(isNull(platformDocuments.deletedAt))
		.orderBy(desc(platformDocuments.updatedAt));
	const faqs = await db
		.select()
		.from(platformFaqs)
		.where(isNull(platformFaqs.deletedAt))
		.orderBy(asc(platformFaqs.section), asc(platformFaqs.sortOrder), asc(platformFaqs.id));

	return {
		docs: docs.map((d) => ({
			id: d.id,
			title: d.title,
			body: d.body,
			sourceUrl: d.sourceUrl,
			keywords: d.keywords,
			updatedAt: d.updatedAt.toISOString()
		})),
		faqs: faqs.map((f) => ({
			id: f.id,
			section: f.section,
			question: f.question,
			answer: f.answer,
			sortOrder: f.sortOrder
		}))
	};
};

/** Shared read + validation for FAQ create/edit. */
function readFaq(form: FormData): { error: string } | { values: { section: string; question: string; answer: string; sortOrder: number } } {
	const section = String(form.get('section') ?? '').trim();
	const question = String(form.get('question') ?? '').trim();
	const answer = String(form.get('answer') ?? '').trim();
	const sortOrder = Number(form.get('sortOrder') ?? 0);
	if (!section) return { error: 'Pick a section for this question.' };
	if (!question) return { error: 'Write the question.' };
	if (!answer) return { error: 'Write the answer.' };
	if (!Number.isInteger(sortOrder) || sortOrder < 0) return { error: 'Order must be a whole number of 0 or more.' };
	return { values: { section, question, answer, sortOrder } };
}

/** Shared read + validation for create and edit. Keywords are normalized to a
 * lowercase comma-separated list here so the router's own matching (which
 * lowercases the question) can stay a plain substring test. */
function readDoc(form: FormData): { error: string } | { values: { title: string; body: string; sourceUrl: string | null; keywords: string } } {
	const title = String(form.get('title') ?? '').trim();
	const body = String(form.get('body') ?? '').trim();
	const sourceUrl = String(form.get('sourceUrl') ?? '').trim();
	const keywords = [
		...new Set(
			String(form.get('keywords') ?? '')
				.split(',')
				.map((k) => k.trim().toLowerCase())
				.filter(Boolean)
		)
	].join(', ');

	if (!title) return { error: 'Give the document a title.' };
	if (!body) return { error: 'The document needs some body text for the AI to answer from.' };
	if (!keywords) return { error: 'Add at least one keyword, otherwise no question will ever match this document.' };
	return { values: { title, body, sourceUrl: sourceUrl || null, keywords } };
}

export const actions: Actions = {
	create: async (event) => {
		const admin = await requireAdmin(event);
		const result = readDoc(await event.request.formData());
		if ('error' in result) return adminActionFailed(admin.domainUser.id, 400, result);
		await db.insert(platformDocuments).values(result.values);
		return { saved: true };
	},

	edit: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		if (!id) return adminActionFailed(admin.domainUser.id, 400, { error: 'Document not found.' });
		const result = readDoc(form);
		if ('error' in result) return adminActionFailed(admin.domainUser.id, 400, result);
		await db
			.update(platformDocuments)
			.set({ ...result.values, updatedAt: new Date() })
			.where(eq(platformDocuments.id, id));
		return { saved: true };
	},

	// Soft delete, matching every other removable record here. A doc pulled from
	// the corpus stays recoverable rather than being destroyed outright.
	remove: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		if (!id) return adminActionFailed(admin.domainUser.id, 400, { error: 'Document not found.' });
		await db
			.update(platformDocuments)
			.set({ deletedAt: new Date() })
			.where(and(eq(platformDocuments.id, id), isNull(platformDocuments.deletedAt)));
		return { saved: true };
	},

	createFaq: async (event) => {
		const admin = await requireAdmin(event);
		const result = readFaq(await event.request.formData());
		if ('error' in result) return adminActionFailed(admin.domainUser.id, 400, result);
		await db.insert(platformFaqs).values(result.values);
		return { saved: true };
	},

	editFaq: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		if (!id) return adminActionFailed(admin.domainUser.id, 400, { error: 'Question not found.' });
		const result = readFaq(form);
		if ('error' in result) return adminActionFailed(admin.domainUser.id, 400, result);
		await db
			.update(platformFaqs)
			.set({ ...result.values, updatedAt: new Date() })
			.where(eq(platformFaqs.id, id));
		return { saved: true };
	},

	// Soft delete: removing a question hides it from /faq and from the AI's
	// grounding, but a reseed won't resurrect it (the seeder only skips
	// questions that are still live) and it stays recoverable in the table.
	removeFaq: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		if (!id) return adminActionFailed(admin.domainUser.id, 400, { error: 'Question not found.' });
		await db
			.update(platformFaqs)
			.set({ deletedAt: new Date() })
			.where(and(eq(platformFaqs.id, id), isNull(platformFaqs.deletedAt)));
		return { saved: true };
	}
};
