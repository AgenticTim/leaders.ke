<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Opted out · vote.ke</title></svelte:head>

<section class="mx-auto max-w-md px-4 py-20 text-center">
	<div class="rounded-2xl border border-border bg-surface p-8">
		<p class="text-4xl">✅</p>
		<h1 class="mt-4 text-xl font-bold text-heading">You've opted out</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted">
			You won't receive any more broadcasts from {data.leaderName}. You can follow again anytime from their public page.
		</p>
		<a href="/" class="mt-6 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95">
			Back to vote.ke
		</a>
	</div>
</section>
