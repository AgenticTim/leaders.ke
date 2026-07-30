<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import favicon from '$lib/assets/favicon.svg';
	import { init as initVowsey } from '$lib/vowsey';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Vowsey analytics + session replay (browser-only). No-ops when the key/host
	// env vars are unset, so dev environments track nothing by default.
	onMount(() => {
		if (env.PUBLIC_VOWSEY_KEY && env.PUBLIC_VOWSEY_HOST) {
			initVowsey({ key: env.PUBLIC_VOWSEY_KEY, host: env.PUBLIC_VOWSEY_HOST });
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col bg-surface">
	<Header user={data.user} />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
</div>
