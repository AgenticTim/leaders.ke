// Async payload for LeaderHoverCard: the large LeaderCard's props for one
// person, fetched on hover (not with the page) so news feeds don't pay for
// cards nobody opens. Public data, cacheable.
import { json } from '@sveltejs/kit';
import { getLeaderCardBySlug } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const slug = (url.searchParams.get('slug') ?? '').replace(/^\//, '').trim();
	if (!slug) return json(null, { status: 400 });
	const card = await getLeaderCardBySlug(slug);
	if (!card) return json(null, { status: 404 });
	setHeaders({ 'cache-control': 'public, max-age=300' });
	return json(card);
};
