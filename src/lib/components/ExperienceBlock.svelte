<script lang="ts">
	import type { Snippet } from 'svelte';
	import PencilIcon from './svgs/PencilIcon.svelte';
	type Props = {
		title: string;
		href?: string;
		subtitle?: string | null;
		description?: string | null;
		dateLabel: string;
		unsaved?: boolean;
		pending?: boolean;
		badge?: string;
		badgeClass?: string;
		onEdit?: () => void;
		onRemove?: () => void;
		// Optional footer, e.g. the deliveries list + "+ Delivered" affordance the
		// Profile tab renders under each saved item.
		footer?: Snippet;
	};

	let {
		title,
		href,
		subtitle,
		description,
		dateLabel,
		unsaved = false,
		pending = false,
		badge,
		badgeClass,
		onEdit,
		onRemove,
		footer
	}: Props = $props();
</script>

<li
	class="relative rounded-xl px-4 py-3 text-sm {pending
		? 'border border-primary/40 bg-primary-soft/30'
		: 'bg-surface-2'}"
>
	{#if href}
		<a {href} class="font-medium text-heading hover:text-primary">{title}</a>
	{:else}
		<p class="font-medium text-heading">{title}</p>
	{/if}
	<p class="flex mt-1 text-muted space-between">
		{#if subtitle}
			{subtitle}
		{/if}
		<span class="ml-auto shrink-0 text-xs whitespace-nowrap">
			{dateLabel}
			{#if unsaved}<span class="font-semibold text-primary">· unsaved</span>{/if}
		</span>
	</p>
	{#if description}
		<p class="mt-1 text-muted italic">{description}</p>
	{/if}

	{#if footer}
		{@render footer()}
	{/if}

	{#if onEdit || onRemove}
		<div class="absolute top-3 right-3 flex items-center gap-2">
			{#if onEdit}
				<button
					type="button"
					onclick={onEdit}
					aria-label="Edit"
					class="text-muted hover:text-heading"
				>
					<PencilIcon size={14} />
				</button>
			{/if}
			{#if onRemove}
				<button
					type="button"
					onclick={onRemove}
					aria-label="Remove"
					class="text-muted hover:text-heading"
				>
					×
				</button>
			{/if}
		</div>
	{:else if badge}
		<span
			class="absolute top-3 right-3 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize {badgeClass}"
		>
			{badge}
		</span>
	{/if}
</li>
