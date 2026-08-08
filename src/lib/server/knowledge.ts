// Feeds the Knowledge tab's FAQ entries, extracted document text and recent
// press coverage into the AI Chat feature's grounding context (see
// $lib/server/ai.ts). One shared helper so every public page that asks the AI a
// question (leader profile, campaign workspace, admin preview) pulls the exact
// same extras the same way.
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { faqEntries, knowledgeDocuments, posts, tags } from '$lib/server/db/schema';
import { getPersonTier } from '$lib/server/invites';
import { getPackageFeatures } from '$lib/server/packages';
import { decodeHtmlEntities } from '$lib/utils/entities';
import { newsSourceName, readableOutlet } from '$lib/utils/newsSource';

export async function getGroundingExtras(subjectUserId: number) {
	const [faqRows, docRows] = await Promise.all([
		db
			.select({ question: faqEntries.question, answer: faqEntries.answer })
			.from(faqEntries)
			.where(and(eq(faqEntries.subjectUserId, subjectUserId), isNull(faqEntries.deletedAt)))
			.orderBy(asc(faqEntries.sortOrder), asc(faqEntries.id)),
		db
			.select({ title: knowledgeDocuments.title, extractedText: knowledgeDocuments.extractedText, fileUrl: knowledgeDocuments.fileUrl })
			.from(knowledgeDocuments)
			.where(and(eq(knowledgeDocuments.subjectUserId, subjectUserId), isNull(knowledgeDocuments.deletedAt)))
	]);
	return {
		faqs: faqRows,
		// Only documents with extracted text are useful grounding. A PDF still
		// pending text extraction (see saveKnowledgeDocument) has nothing to quote.
		// url rides along ONLY for link-sourced documents (an absolute http(s) URL,
		// see addLink in the Knowledge tab) so the AI can point a citizen straight at
		// the source (e.g. a YouTube video whose transcript isn't available) instead
		// of just declining. An uploaded FILE's fileUrl is our own auth-gated
		// /uploads/knowledge/... route, never public, so it's never handed to the AI.
		documents: docRows
			.filter((d): d is { title: string; extractedText: string; fileUrl: string } => !!d.extractedText)
			.map((d) => ({ title: d.title, text: d.extractedText, url: d.fileUrl.startsWith('http') ? d.fileUrl : null }))
	};
}

/** Recent press mentions of a person, for AI grounding.
 *
 * Ingested mentions live in `posts` with a null creatorId and no
 * subjectUserId: the person is linked through `tags`, which is why the AI's
 * own posts query (keyed on posts.subjectUserId, i.e. what the TEAM wrote)
 * never sees them.
 *
 * Gated on the PR AI Agent perk, the same way the dashboard News tab and the
 * daily brief gate coverage: a profile that hasn't paid for press monitoring
 * shouldn't get it through the chat instead. Returns [] when locked.
 */
export async function getNewsGrounding(subjectUserId: number, limit = 10) {
	const tier = await getPersonTier(subjectUserId);
	if (!(await getPackageFeatures(tier))?.prAiAgent) return [];

	const rows = await db
		.select({ title: posts.title, body: posts.body, sourceUrl: posts.sourceUrl, createdAt: posts.createdAt })
		.from(tags)
		.innerJoin(posts, eq(tags.postId, posts.id))
		.where(
			and(
				eq(tags.subjectUserId, subjectUserId),
				isNull(tags.creatorId), // the aggregation's own tag, not a team @mention
				isNull(tags.deletedAt),
				isNull(posts.creatorId), // system-ingested, not a team post
				isNull(posts.deletedAt)
			)
		)
		.orderBy(desc(posts.createdAt))
		.limit(limit);

	return rows.map((r) => {
		const title = decodeHtmlEntities(r.title);
		return {
			title,
			// The excerpt often just repeats the headline; drop it when it does,
			// rather than paying twice for the same sentence in the prompt.
			body: (() => {
				const body = decodeHtmlEntities(r.body).trim();
				return body && body !== title ? body.slice(0, 300) : '';
			})(),
			outlet: readableOutlet(newsSourceName(r.sourceUrl, title)),
			date: r.createdAt.toISOString().slice(0, 10)
		};
	});
}
