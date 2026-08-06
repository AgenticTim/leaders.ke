<script lang="ts">
	// Outline newspaper glyph: a sheet with a masthead rule and body lines. Drawn
	// in currentColor so callers set the tone (muted beside a follower count).
	let { class: className = 'size-5', title }: { class?: string; title?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden={title ? undefined : 'true'}
>
	{#if title}<title>{title}</title>{/if}
	<path d="M4 5.5h12.5v11.9a2.1 2.1 0 0 0 2.1 2.1H6.1A2.1 2.1 0 0 1 4 17.4V5.5Z" />
	<path d="M16.5 9.5H20v7.9a2.1 2.1 0 0 1-2.1 2.1" />
	<path d="M6.9 8.6h6.7M6.9 11.7h6.7M6.9 14.8h4" />
</svg>
