<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.article.title} — vote.ke</title>
	<meta name="description" content={data.article.summary} />
</svelte:head>

<article class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
	<a href="/learn" class="text-sm font-medium text-primary hover:underline">← Voter education</a>
	<p class="mt-4 text-xs font-semibold tracking-wide text-primary uppercase">{data.article.category}</p>
	<h1 class="mt-1 text-3xl font-bold text-heading">{data.article.title}</h1>

	<div class="mt-6 space-y-4 text-base leading-relaxed">
		{#each data.article.body as paragraph (paragraph)}
			<p>{paragraph}</p>
		{/each}
	</div>

	<div class="mt-8 rounded-xl border border-border bg-surface-2 p-4 text-sm text-muted">
		This guide is general civic education, not legal advice. Rules and dates are set by the IEBC —
		confirm specifics at
		<a href="https://www.iebc.or.ke" class="underline hover:text-heading">iebc.or.ke</a>.
	</div>

	{#if data.related.length}
		<h2 class="mt-10 text-lg font-semibold text-heading">Keep reading</h2>
		<ul class="mt-3 space-y-2">
			{#each data.related as item (item.slug)}
				<li>
					<a href="/learn/{item.slug}" class="text-sm font-medium text-primary hover:underline">
						{item.title}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</article>
