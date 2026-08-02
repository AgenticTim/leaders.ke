<script lang="ts">
	import { tooltip } from '$lib/effects';
	// One-click cross-posting via the networks' share intents: opens X's or
	// Facebook's composer prefilled with the text + link — no API keys, no
	// OAuth, works for any signed-in browser session. A future real connector
	// (auto-posting via stored tokens) replaces these hrefs, not the UI.
	let { text, url }: { text: string; url: string } = $props();

	const xHref = $derived(
		`https://twitter.com/intent/tweet?text=${encodeURIComponent(text.slice(0, 240))}&url=${encodeURIComponent(url)}`
	);
	const fbHref = $derived(
		`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text.slice(0, 480))}`
	);
</script>

<a
	href={xHref}
	target="_blank"
	rel="noopener"
	use:tooltip={'Post on X'}
	class="rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold text-heading transition hover:bg-surface-2"
>
	𝕏 Post
</a>
<a
	href={fbHref}
	target="_blank"
	rel="noopener"
	use:tooltip={'Share on Facebook'}
	class="rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold text-heading transition hover:bg-surface-2"
>
	f Share
</a>
