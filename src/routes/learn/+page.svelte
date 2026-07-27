<script lang="ts">
	import articles from '$lib/data/education.json';

	// Group by category, preserving the file's order within each group.
	const categories = [...new Set(articles.map((a) => a.category))];
</script>

<svelte:head>
	<title>Voter education — vote.ke</title>
	<meta name="description" content="Plain-language guides to registering, voting and your rights in Kenya's 2027 General Election." />
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
	<h1 class="text-3xl font-bold text-heading">Voter education</h1>
	<p class="mt-2 max-w-2xl text-base">
		Plain-language, non-partisan guides to the 2027 General Election. 
	</p>

	<!-- Start here: the case for voting at all, ahead of the how-to guides -->
	<a
		href="/why-vote"
		class="mt-8 flex flex-col gap-2 rounded-2xl border border-primary/40 bg-primary-soft p-6 transition hover:border-primary hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
	>
		<div>
			<p class="text-xs font-semibold tracking-wide text-on-primary/70 uppercase">Start here</p>
			<h2 class="mt-1 text-xl font-bold text-on-primary">Why vote?</h2>
			<p class="mt-1 text-sm text-on-primary/80">
				Six ballots decide who runs your country, your county, and your ward. The case for showing
				up on 10 August 2027.
			</p>
		</div>
		<span class="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary">
			Read →
		</span>
	</a>

	{#each categories as category (category)}
		<h2 class="mt-10 text-xl font-semibold text-heading">{category}</h2>
		<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each articles.filter((a) => a.category === category) as article (article.slug)}
				<a
					href="/learn/{article.slug}"
					class="flex flex-col rounded-2xl border border-border bg-surface p-5 transition hover:border-primary hover:shadow-sm"
				>
					<h3 class="font-semibold text-heading">{article.title}</h3>
					<p class="mt-2 flex-1 text-sm text-muted">{article.summary}</p>
					<span class="mt-3 text-sm font-semibold text-primary">Read →</span>
				</a>
			{/each}
		</div>
	{/each}
</section>
