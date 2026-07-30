// TEMPORARY dev-only smoke-test endpoint for newsIngest — delete after use.
import { json } from '@sveltejs/kit';
import { ingestNews } from '$lib/server/newsIngest';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const limit = Number(url.searchParams.get('limit') ?? 5);
	const result = await ingestNews({ limitPeople: limit });
	return json(result);
};
