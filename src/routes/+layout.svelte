<script lang="ts">
	import './layout.css';
	import { env } from '$env/dynamic/public';
	import favicon from '$lib/assets/favicon.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { FlatToast, ToastContainer } from 'svelte-toasts';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Tie Vowsey events to the signed-in account (window.vowsey comes from the
	// script tag above), so Analytics can show identified users/conversion and
	// replays attribute to the account instead of just an anonymous visitor id.
	// The SDK loads async (defer) and data.user changes on login/logout without a
	// full reload, so this retries briefly until the SDK is ready and re-applies
	// whenever the signed-in id changes.
	$effect(() => {
		const userId = data.user?.id ?? null;
		if (typeof window === 'undefined') return;
		let cancelled = false;
		let attempts = 0;
		const apply = () => {
			if (cancelled) return;
			const vowsey = (window as unknown as { vowsey?: { identify: (id: string | null) => void } }).vowsey;
			if (vowsey) vowsey.identify(userId);
			else if (attempts++ < 20) setTimeout(apply, 250);
		};
		apply();
		return () => {
			cancelled = true;
		};
	});
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

<!-- Global toast host (toast.ts wraps svelte-toasts) — mounted once here so any
page/component can call toast.info/success/warn/error without its own container. -->
<ToastContainer let:data={data} showProgress={true} duration={5000}>
	<FlatToast {data} />
</ToastContainer>
