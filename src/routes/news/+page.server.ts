import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The news feed lives on the homepage; old /news links (bookmarks, shared
// filter URLs, search results) land there with their filters intact.
// Individual articles keep their /news/[slug] pages below this path.
export const load: PageServerLoad = ({ url }) => {
	const qs = url.searchParams.toString();
	redirect(301, qs ? `/?${qs}` : '/');
};
