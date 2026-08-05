<script lang="ts">
	// FAQ content lives in platform_faqs (seeded from src/lib/data/platformFaqs.json,
	// editable at /dashboard/admin/knowledge) rather than in this file, so the
	// answers here are the same ones the site-wide Ask box grounds on. Search
	// filters question + answer text client-side.
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let query = $state('');
	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return data.sections;
		return data.sections
			.map((s) => ({
				...s,
				items: s.items.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))
			}))
			.filter((s) => s.items.length > 0);
	});
</script>

<svelte:head>
	<title>FAQ · vote.ke</title>
	<meta name="description" content="Frequently asked questions about vote.ke, for citizens, leaders, campaign teams, billing, and data." />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
	<h1 class="text-3xl font-bold text-heading">Frequently asked questions</h1>
	<p class="mt-3 text-lg text-muted">
		Everything about the platform, in one place. <a href="/contact-us" class="font-medium text-primary hover:underline">Contact us</a> if something is missing.
	</p>

	<input
		type="search"
		bind:value={query}
		placeholder="Search the FAQ…"
		aria-label="Search the FAQ"
		class="mt-6 w-full rounded-full border border-border bg-surface px-5 py-3 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
	/>

	{#each visible as section (section.title)}
		<section class="mt-8" aria-label={section.title}>
			<h2 class="text-lg font-semibold text-heading">{section.title}</h2>
			<div class="mt-3 space-y-2">
				{#each section.items as faq (faq.question)}
					<details class="group rounded-2xl border border-border bg-surface p-4" open={!!query.trim()}>
						<summary class="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-heading">
							{faq.question}
							<span class="text-muted transition group-open:rotate-180">⌄</span>
						</summary>
						<p class="mt-2 text-sm leading-relaxed text-muted">{faq.answer}</p>
					</details>
				{/each}
			</div>
		</section>
	{:else}
		<p class="mt-8 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
			Nothing matches "{query}", try another word, or <a href="/contact-us" class="font-medium text-primary hover:underline">ask us directly</a>.
		</p>
	{/each}
</div>
