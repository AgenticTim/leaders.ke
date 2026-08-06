// Serves party logos from local disk. Logos are public. They render on the
// public /parties directory and each party page, so no auth, just a traversal
// guard and a long cache.
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getObject } from '$lib/server/objectStore';
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
	// No path separators in either segment, blocks directory traversal.
	if (!partyId || !filename || /[/\\]/.test(filename) || filename.includes('..')) {
		error(404, 'Not found');
	}

	// Bucket first, disk second (see objectStore): uploads written before
	// the bucket was configured still resolve.
	const buffer = await getObject(`parties/${partyId}/${filename}`);
	if (!buffer) error(404, 'Not found');

	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	return new Response(new Uint8Array(buffer), {
		headers: {
			'content-type': EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream',
			// Uploads are UUID-named and never rewritten in place (a replacement gets
			// its own filename and the DB points at that), so the bytes behind a URL
			// are immutable and a browser never needs to revalidate.
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
