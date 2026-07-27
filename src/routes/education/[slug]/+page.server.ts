import { error } from '@sveltejs/kit';
import articles from '$lib/data/education.json';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const article = articles.find((a) => a.slug === params.slug);
	if (!article) error(404, 'Article not found');

	// Same-category reads, excluding the open article.
	const related = articles
		.filter((a) => a.category === article.category && a.slug !== article.slug)
		.map(({ slug, title }) => ({ slug, title }));

	return { article, related };
};
