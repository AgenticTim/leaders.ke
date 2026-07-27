<script lang="ts">
	import dates from '$lib/data/dates.json';

	const fmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'long' });
	const today = new Date().toISOString().slice(0, 10);
	// Chronological; the next upcoming milestone gets highlighted.
	const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
	const nextIndex = sorted.findIndex((d) => d.date >= today);
</script>

<svelte:head>
	<title>Key 2027 election dates — vote.ke</title>
	<meta name="description" content="The road to Kenya's 2027 General Election: registration, inspection, nominations, campaigns and election day." />
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
	<h1 class="text-3xl font-bold text-heading">Key dates</h1>
	<p class="mt-2 text-base">
		The road to 10 August 2027. Dates marked <span class="font-semibold">expected</span> follow the
		usual electoral calendar but are not yet gazetted by the IEBC — confirm before planning around
		them.
	</p>

	<ol class="mt-8 space-y-0">
		{#each sorted as item, i (item.date + item.title)}
			<li class="relative border-l-2 pl-6 pb-8 {i === nextIndex ? 'border-primary' : 'border-border'}">
				<span
					class="absolute top-1 -left-[7px] size-3 rounded-full {i === nextIndex
						? 'bg-primary'
						: item.date < today
							? 'bg-border'
							: 'bg-surface-3'}"
				></span>
				<p class="text-sm font-semibold {i === nextIndex ? 'text-primary' : 'text-muted'}">
					{fmt.format(new Date(item.date))}
					{#if item.expected}
						<span class="ml-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">expected</span>
					{/if}
					{#if i === nextIndex}
						<span class="ml-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-on-primary">up next</span>
					{/if}
				</p>
				<h2 class="mt-1 text-lg font-semibold text-heading">{item.title}</h2>
				<p class="mt-1 text-sm">{item.summary}</p>
			</li>
		{/each}
	</ol>

	<p class="rounded-xl border border-border bg-surface-2 p-4 text-sm text-muted">
		Official calendar and gazette notices:
		<a href="https://www.iebc.or.ke" class="underline hover:text-heading">iebc.or.ke</a>
	</p>
</section>
