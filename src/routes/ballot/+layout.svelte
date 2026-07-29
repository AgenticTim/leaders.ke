<script lang="ts">
	import BallotDisclaimer from '$lib/components/BallotDisclaimer.svelte';

	let { children } = $props();
</script>

<!-- Fills the viewport below the sticky h-16 header (scoped here — sizing the root
<main> globally shifted other views): content takes the remaining height so the
disclaimer sits at the bottom even on short pages, in normal flow (not pinned)
while scrolling. -->
<div class="flex min-h-[calc(100dvh-4rem)] flex-col">
	<div class="flex-1">
		{@render children()}
	</div>

	<BallotDisclaimer sticky={false} />
</div>
