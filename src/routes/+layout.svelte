<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// The homepage is the voting-booth wizard: exactly one viewport tall, no
	// vertical scrolling — the site footer would force a scrollbar there.
	const isBooth = $derived(page.url.pathname === '/');
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col bg-surface">
	<Header user={data.user} />
	<main class="flex-1">
		{@render children()}
	</main>
	{#if !isBooth}
		<Footer />
	{/if}
</div>
