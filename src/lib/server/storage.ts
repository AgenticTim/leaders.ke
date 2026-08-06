// File storage for uploads (campaign documentation, party logos, Knowledge-tab
// sources). Objects go to the S3-compatible bucket when it's configured and to
// local disk when it isn't, which objectStore.ts decides; either way the stored
// URL is `/uploads/...`, served back by the routes under src/routes/uploads.
import { randomUUID } from 'node:crypto';
import { putObject } from '$lib/server/objectStore';
import { extractText, getDocumentProxy } from 'unpdf';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB, generous for a phone photo/scan or a short PDF

export type UploadKind = 'photo' | 'id-front' | 'id-back' | 'iebc-certificate';

const ALLOWED_MIME: Record<UploadKind, string[]> = {
	photo: ['image/jpeg', 'image/png', 'image/webp'],
	'id-front': ['image/jpeg', 'image/png', 'image/webp'],
	'id-back': ['image/jpeg', 'image/png', 'image/webp'],
	'iebc-certificate': ['application/pdf']
};

const EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'application/pdf': 'pdf'
};

/** Saves an uploaded document for a PERSON (users.id) + document kind, returning
 * the public URL to persist. Keyed by the person, documents follow them across
 * terms and runs, and a pure aspirant has no leaders row to key on. Rejects the
 * wrong file type/size before anything touches disk. */
export async function saveLeaderDocument(subjectUserId: number, kind: UploadKind, file: File): Promise<string> {
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new Error('File is larger than 10 MB.');
	}
	if (!ALLOWED_MIME[kind].includes(file.type)) {
		throw new Error(
			kind === 'iebc-certificate' ? 'The IEBC certificate must be a PDF.' : 'That file must be an image (JPEG, PNG, or WebP).'
		);
	}

	const ext = EXT_BY_MIME[file.type] ?? 'bin';
	const filename = `${randomUUID()}.${ext}`;
	const key = `leaders/${subjectUserId}/${filename}`;
	await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
	return `/uploads/${key}`;
}

const PARTY_LOGO_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/svg+xml': 'svg'
};

/** Saves a party logo (admin upload) under .uploads/parties/<id>/, returning the
 * URL to persist on parties.logo. SVG is allowed since ORPP symbols are often
 * vector; served as a static file via /uploads, never inlined. */
export async function savePartyLogo(partyId: number, file: File): Promise<string> {
	if (file.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 10 MB.');
	const ext = PARTY_LOGO_MIME[file.type];
	if (!ext) throw new Error('The logo must be a PNG, JPEG, WebP, or SVG image.');

	const filename = `${randomUUID()}.${ext}`;
	const key = `parties/${partyId}/${filename}`;
	await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
	return `/uploads/${key}`;
}

const KNOWLEDGE_MIME: Record<string, string> = {
	'application/pdf': 'pdf',
	'text/plain': 'txt',
	'text/markdown': 'md'
};

/** Saves a Knowledge-tab source document (see faqEntries/knowledgeDocuments in
 * schema.ts) and returns its URL plus whatever text could be extracted for the AI
 * grounding context. Text formats (.txt/.md) extract immediately; PDFs are parsed
 * via unpdf (pure-JS, no native binary, safe for a serverless/edge deploy target).
 * extractedText is null only when a PDF has no extractable text (e.g. a scanned
 * image with no text layer). The file still uploads and lists either way. */
export async function saveKnowledgeDocument(
	subjectUserId: number,
	file: File
): Promise<{ fileUrl: string; extractedText: string | null }> {
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new Error('File is larger than 10 MB.');
	}
	const ext = KNOWLEDGE_MIME[file.type];
	if (!ext) {
		throw new Error('That file must be a PDF, plain text (.txt), or Markdown (.md) document.');
	}

	const filename = `${randomUUID()}.${ext}`;
	const key = `knowledge/${subjectUserId}/${filename}`;
	const buffer = Buffer.from(await file.arrayBuffer());
	await putObject(key, buffer, file.type);

	let extractedText: string | null;
	if (ext === 'pdf') {
		try {
			const pdf = await getDocumentProxy(new Uint8Array(buffer));
			const { text } = await extractText(pdf, { mergePages: true });
			extractedText = text.trim() || null;
		} catch (err) {
			console.error(`PDF text extraction failed for ${filename}:`, err);
			extractedText = null;
		}
	} else {
		extractedText = buffer.toString('utf-8');
	}

	return { fileUrl: `/uploads/${key}`, extractedText };
}
