// The Knowledge tab (/dashboard/[slug]/knowledge) — what a verified team curates to
// ground the AI Chat feature's answers (see $lib/server/ai.ts): an FAQ builder plus
// source-document uploads. Verified-only (unlike every other manager tab, which is
// always reachable regardless of verification — see the comment on `sections` in
// dashboard/+layout.svelte) because the AI only ever answers on a leader's PUBLIC
// profile, which itself only exists once verified. Each add/remove saves
// immediately, same convention as the Delivery tab.
import { fail } from '@sveltejs/kit';
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { faqEntries, knowledgeDocuments } from '$lib/server/db/schema';
import { requireLeader } from '$lib/server/dashboard';
import { redirectWithFlash } from '$lib/server/flash';
import { previewLinkContent } from '$lib/server/linkExtract';
import { saveKnowledgeDocument } from '$lib/server/storage';
import { getPersonTier } from '$lib/server/invites';
import { getPackageFeatures } from '$lib/server/packages';
import { getPlatformSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

/** Throws once this leader's total extracted-text characters (existing docs,
 * minus the one being edited if any, plus what's about to be saved) would
 * cross their plan's knowledgeMb storage cap (admin-editable on
 * /dashboard/admin/packages; null = unlimited) — the paid-tier gate. This is
 * a storage limit only: how much AI Chat actually reads per question is a
 * separate, much smaller budget (platformSettings.maxGroundingChars) that
 * groundingText() in $lib/server/ai.ts silently trims to at ask-time, not
 * enforced here — the Knowledge tab just shows how much of that budget is
 * used and highlights what won't fit, it never blocks a save over it. 1 MB ≈
 * 1,000,000 characters of plain text (docs/ai-chat-costs.md). */
async function assertWithinKnowledgeCap(subjectUserId: number, addedChars: number, excludeDocId?: number): Promise<void> {
	const tier = await getPersonTier(subjectUserId);
	const planCapMb = (await getPackageFeatures(tier))?.knowledgeMb ?? null;
	if (planCapMb === null) return;

	const rows = await db
		.select({ text: knowledgeDocuments.extractedText })
		.from(knowledgeDocuments)
		.where(
			and(
				eq(knowledgeDocuments.subjectUserId, subjectUserId),
				isNull(knowledgeDocuments.deletedAt),
				excludeDocId ? ne(knowledgeDocuments.id, excludeDocId) : undefined
			)
		);
	const existingChars = rows.reduce((n, r) => n + (r.text?.length ?? 0), 0);
	if (existingChars + addedChars > planCapMb * 1_000_000) {
		const planLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
		throw new Error(`${planCapMb}mb upload cap reached for ${planLabel} plan. Upgrade to upload more data.`);
	}
}

export const load: PageServerLoad = async (event) => {
	const { ctx } = await requireLeader(event);
	if (!ctx.verified) redirectWithFlash(event.cookies, '../profile', 'The Knowledge tab unlocks once your profile is verified.');

	const [faqRows, documentRows, settings] = await Promise.all([
		db
			.select({ id: faqEntries.id, question: faqEntries.question, answer: faqEntries.answer })
			.from(faqEntries)
			.where(and(eq(faqEntries.subjectUserId, ctx.profileUser.id), isNull(faqEntries.deletedAt)))
			.orderBy(asc(faqEntries.sortOrder), asc(faqEntries.id)),
		db
			.select({
				id: knowledgeDocuments.id,
				title: knowledgeDocuments.title,
				fileUrl: knowledgeDocuments.fileUrl,
				mimeType: knowledgeDocuments.mimeType,
				text: knowledgeDocuments.extractedText
			})
			.from(knowledgeDocuments)
			.where(and(eq(knowledgeDocuments.subjectUserId, ctx.profileUser.id), isNull(knowledgeDocuments.deletedAt)))
			.orderBy(asc(knowledgeDocuments.id)),
		getPlatformSettings()
	]);

	const usedChars = documentRows.reduce((n, d) => n + (d.text?.length ?? 0), 0);

	return {
		faqs: faqRows,
		documents: documentRows.map((d) => ({ id: d.id, title: d.title, fileUrl: d.fileUrl, mimeType: d.mimeType, text: d.text ?? '', textReady: !!d.text })),
		// Live usage against the per-question grounding cap (docs/ai-chat-costs.md) —
		// the Knowledge tab highlights whatever's over this and warns it'll be
		// trimmed from AI answers, but never blocks saving past it (unlike the
		// plan's knowledgeMb storage cap, which does).
		knowledgeUsage: { used: usedChars, cap: settings.maxGroundingChars }
	};
};

export const actions: Actions = {
	addFaq: async (event) => {
		const { ctx } = await requireLeader(event);
		if (!ctx.verified) return fail(400, { error: 'Verify your profile first.' });
		const form = await event.request.formData();
		const question = String(form.get('question') ?? '').trim();
		const answer = String(form.get('answer') ?? '').trim();
		if (!question) return fail(400, { error: 'Every FAQ needs a question.' });
		if (!answer) return fail(400, { error: 'Every FAQ needs an answer.' });
		if (question.length > 500) return fail(400, { error: 'Keep the question under 500 characters.' });

		const [{ n }] = await db
			.select({ n: count() })
			.from(faqEntries)
			.where(and(eq(faqEntries.subjectUserId, ctx.profileUser.id), isNull(faqEntries.deletedAt)));
		await db.insert(faqEntries).values({ subjectUserId: ctx.profileUser.id, question, answer, sortOrder: n });
		return { saved: true };
	},

	removeFaq: async (event) => {
		const { ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		if (!id) return fail(400, { error: 'Nothing to remove.' });
		await db.update(faqEntries).set({ deletedAt: new Date() }).where(and(eq(faqEntries.id, id), eq(faqEntries.subjectUserId, ctx.profileUser.id)));
		return { saved: true };
	},

	// Step 1 of the file flow, mirrors previewLink: writes the file to disk and
	// extracts its text, but doesn't save a knowledgeDocuments row yet — the team
	// reviews (and can edit) the title/text below before it becomes AI grounding.
	previewDocument: async (event) => {
		const { ctx } = await requireLeader(event);
		if (!ctx.verified) return fail(400, { error: 'Verify your profile first.' });
		const form = await event.request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a file to upload.' });

		try {
			const { fileUrl, extractedText } = await saveKnowledgeDocument(ctx.profileUser.id, file);
			await assertWithinKnowledgeCap(ctx.profileUser.id, extractedText?.length ?? 0);
			return {
				previewed: true,
				preview: {
					kind: 'document' as const,
					title: file.name.replace(/\.[^.]+$/, ''),
					content: extractedText ?? '',
					sourceUrl: fileUrl,
					mimeType: file.type
				}
			};
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Upload failed.' });
		}
	},

	// Step 2, shared by both the file and link flows: commits the (possibly
	// hand-edited) preview as a document. sourceUrl is the saved file's own
	// /uploads/knowledge/... URL for an upload, or the original page/video link for
	// a link — either way there's nothing left to fetch, just save what's shown.
	saveDocument: async (event) => {
		const { ctx } = await requireLeader(event);
		if (!ctx.verified) return fail(400, { error: 'Verify your profile first.' });
		const form = await event.request.formData();
		const title = String(form.get('title') ?? '').trim();
		const content = String(form.get('content') ?? '').trim();
		const sourceUrl = String(form.get('sourceUrl') ?? '').trim();
		const mimeType = String(form.get('mimeType') ?? 'text/plain').trim();
		if (!title) return fail(400, { error: 'Give the document a title.' });
		if (!content) return fail(400, { error: 'There is no text to save.' });
		if (!sourceUrl) return fail(400, { error: 'Missing source.' });

		try {
			await assertWithinKnowledgeCap(ctx.profileUser.id, content.length);
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Upload cap reached.' });
		}

		await db.insert(knowledgeDocuments).values({ subjectUserId: ctx.profileUser.id, title, fileUrl: sourceUrl, mimeType, extractedText: content });
		return { saved: true };
	},

	// Edits an already-saved document's title/text in place (opened by clicking its
	// title in the list) — the underlying file/link (fileUrl, mimeType) doesn't change.
	updateDocument: async (event) => {
		const { ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		const title = String(form.get('title') ?? '').trim();
		const content = String(form.get('content') ?? '').trim();
		if (!id) return fail(400, { error: 'Nothing to update.' });
		if (!title) return fail(400, { error: 'Give the document a title.' });
		if (!content) return fail(400, { error: 'The document needs text.' });

		try {
			await assertWithinKnowledgeCap(ctx.profileUser.id, content.length, id);
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Upload cap reached.' });
		}

		await db
			.update(knowledgeDocuments)
			.set({ title, extractedText: content })
			.where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.subjectUserId, ctx.profileUser.id)));
		return { updated: true };
	},

	removeDocument: async (event) => {
		const { ctx } = await requireLeader(event);
		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		if (!id) return fail(400, { error: 'Nothing to remove.' });
		await db.update(knowledgeDocuments).set({ deletedAt: new Date() }).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.subjectUserId, ctx.profileUser.id)));
		return { saved: true };
	},

	// Step 1 of the link flow: fetch and extract, but don't save yet — the team
	// reviews (and can edit) what was pulled out before it becomes grounding
	// content the AI actually quotes from. YouTube links get title + description +
	// a best-effort transcript (see $lib/server/linkExtract); anything else gets
	// the page's readable text.
	previewLink: async (event) => {
		const { ctx } = await requireLeader(event);
		if (!ctx.verified) return fail(400, { error: 'Verify your profile first.' });
		const form = await event.request.formData();
		const url = String(form.get('url') ?? '').trim();
		if (!url) return fail(400, { error: 'Paste a link first.' });

		try {
			const preview = await previewLinkContent(url);
			return { previewed: true, preview };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Could not fetch that link.' });
		}
	}
	// Step 2 (saving the link's preview) is the same `saveDocument` action the
	// file flow uses above — sourceUrl is the link itself, mimeType 'text/plain'.
};
