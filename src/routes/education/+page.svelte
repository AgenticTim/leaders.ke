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
	<section class="mt-8 rounded-2xl border border-primary/40 bg-primary-soft p-6">
		<p class="text-xs font-semibold tracking-wide text-on-primary/70 uppercase">Start here</p>
		<h2 class="mt-1 text-xl font-bold text-on-primary">Why vote?</h2>
		<p class="mt-1 text-sm text-on-primary/80">
			Six ballots decide who runs your country, your county, and your ward. Here's why yours counts.
		</p>

		<div class="mt-5 space-y-4 text-sm leading-relaxed">
			<div>
				<h3 class="font-semibold text-on-primary">Your vote is six votes</h3>
				<p class="mt-1 text-on-primary/80">
					On 10 August 2027 you elect a President, Governor, Senator, Woman Representative, MP, and
					MCA. The MCA who fixes your road and the Governor who runs your hospital are on the same
					ballot as the President — down-ballot races are often decided by a handful of votes.
				</p>
			</div>
			<div>
				<h3 class="font-semibold text-on-primary">Fence-sitting is a vote too</h3>
				<p class="mt-1 text-on-primary/80">
					Staying home doesn't opt you out — it hands your share of the decision to whoever did show
					up. Gen Z and millennials are the largest voting bloc in Kenya; they decide every race they
					turn up for.
				</p>
			</div>
			<div>
				<h3 class="font-semibold text-on-primary">Vote records, not slogans</h3>
				<p class="mt-1 text-on-primary/80">
					vote.ke exists so you can vote on evidence: learn how registration and the six ballots
					work, follow the candidates in your races, and practise your whole ballot before the day.
				</p>
			</div>
		</div>

		<div class="mt-5 flex flex-wrap gap-3">
			<a
				href="/"
				class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95"
			>
				Simulate your 2027 ballot
			</a>
			<a
				href="/compare"
				class="rounded-full border border-on-primary/40 px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary/10"
			>
				Compare candidates
			</a>
		</div>
	</section>

	{#each categories as category (category)}
		<h2 class="mt-10 text-xl font-semibold text-heading">{category}</h2>
		<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each articles.filter((a) => a.category === category) as article (article.slug)}
				<a
					href="/education/{article.slug}"
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
