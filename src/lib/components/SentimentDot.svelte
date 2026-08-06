<script lang="ts">
	import { tooltip } from '$lib/effects';

	// Tone of one article toward the leader it's tagged to, classified at ingest
	// (posts.sentiment, see newsIngest.ts).
	//
	// Shape carries the meaning, colour reinforces it: on the light surface the
	// green/red pair sits in the CVD floor band, where colour alone is not a legal
	// encoding, so positive/negative are a triangle up/down and neutral is a bar.
	// That also survives forced-colors and monochrome print.
	let { sentiment, class: className = '' }: { sentiment: string | null; class?: string } = $props();

	const meta = $derived(
		sentiment === 'positive'
			? { label: 'Positive sentiment', tone: 'text-tone-positive', path: 'M6 2.5 10.2 9.5H1.8Z' }
			: sentiment === 'negative'
				? { label: 'Negative sentiment', tone: 'text-tone-negative', path: 'M6 9.5 1.8 2.5h8.4Z' }
				: { label: 'Neutral sentiment', tone: 'text-tone-neutral', path: 'M1.8 5h8.4v2H1.8Z' }
	);
</script>

{#if sentiment}
	<span
		use:tooltip={`${meta.label}, automatically classified`}
		aria-label="{meta.label}, automatically classified"
		class="inline-flex shrink-0 items-center align-middle {meta.tone} {className}"
	>
		<svg viewBox="0 0 12 12" class="size-6" fill="currentColor" aria-hidden="true">
			<path d={meta.path} />
		</svg>
	</span>
{/if}
