<script lang="ts">
	import './layout.css';
	import { env } from '$env/dynamic/public';
	import favicon from '$lib/assets/favicon.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- Vowsey analytics + session replay via the hosted snippet (auto-inits off
	     data-key; host derives from the script origin). Omitted entirely when the
	     env vars are unset, so dev environments track nothing by default. -->
	{#if env.PUBLIC_VOWSEY_KEY && env.PUBLIC_VOWSEY_HOST}
		<script src="{env.PUBLIC_VOWSEY_HOST}/sdk.js" data-key={env.PUBLIC_VOWSEY_KEY} defer></script>
	{/if}
</svelte:head>

<div class="flex min-h-screen flex-col bg-surface">
	<Header user={data.user} />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
</div>
