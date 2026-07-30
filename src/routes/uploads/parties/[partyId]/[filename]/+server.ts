// Serves party logos from local disk. Logos are public — they render on the
// public /parties directory and each party page — so no auth, just a traversal
// guard and a long cache.
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const EXT_CONTENT_TYPE: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	svg: 'image/svg+xml'
};

export const GET: RequestHandler = async (event) => {
	const partyId = Number(event.params.partyId);
	const filename = event.params.filename;
	// No path separators in either segment — blocks directory traversal.
	if (!partyId || !filename || /[/\\]/.test(filename) || filename.includes('..')) {
		error(404, 'Not found');
	}

	const localDir = env.STORAGE_LOCAL_DIR || '.uploads';
	const filePath = path.join(process.cwd(), localDir, 'parties', String(partyId), filename);

	let buffer: Buffer;
	try {
		buffer = await readFile(filePath);
	} catch {
		error(404, 'Not found');
	}

	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	return new Response(new Uint8Array(buffer), {
		headers: {
			'content-type': EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream',
			'cache-control': 'public, max-age=3600'
		}
	});
};
