<script lang="ts">
	// The blue verification check used beside names everywhere (leader cards,
	// booth ballot, campaign pill, dashboard header). `title` is the hover
	// tooltip — pass the context-specific wording; omit for no tooltip.
	let {
		class: className = 'size-4 text-primary',
		title = '',
		label = 'Verified'
	}: { class?: string; title?: string; label?: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-label={label}>
	{#if title}<title>{title}</title>{/if}
	<path
		fill-rule="evenodd"
		d="M8.6 3.8a4.5 4.5 0 0 0-1.4 1 4.5 4.5 0 0 0-3.8 3.7 4.5 4.5 0 0 0 0 5 4.5 4.5 0 0 0 3.7 3.8 4.5 4.5 0 0 0 5 0 4.5 4.5 0 0 0 3.8-3.7 4.5 4.5 0 0 0 0-5 4.5 4.5 0 0 0-3.7-3.8 4.5 4.5 0 0 0-3.6-1Zm5.5 5.4a.85.85 0 1 0-1.4-1l-3.7 4.9-2-2a.85.85 0 1 0-1.2 1.2l2.6 2.8a.85.85 0 0 0 1.3-.1l4.3-5.8Z"
		clip-rule="evenodd"
	/>
</svg>
