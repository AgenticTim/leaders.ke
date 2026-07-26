<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	// Labeled input used across every auth form so styling stays consistent.
	interface Props {
		label: string;
		name: string;
		type?: 'text' | 'email' | 'password';
		value?: string;
		required?: boolean;
		readonly?: boolean;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		placeholder?: string;
	}

	let {
		label,
		name,
		type = 'text',
		value = $bindable(''),
		required = false,
		readonly = false,
		autocomplete,
		placeholder
	}: Props = $props();

	// Password fields get a show/hide toggle; every other type renders as-is.
	let revealed = $state(false);
	const effectiveType = $derived(type === 'password' && revealed ? 'text' : type);
</script>

<label class="block">
	<span class="mb-1 block text-sm font-medium text-heading">{label}</span>
	<div class="relative">
		<input
			{name}
			type={effectiveType}
			{required}
			{readonly}
			{autocomplete}
			{placeholder}
			bind:value
			class="w-full rounded-lg border border-border bg-surface px-3 py-2 {type === 'password'
				? 'pr-10'
				: ''} text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none {readonly
				? 'cursor-not-allowed opacity-70'
				: ''}"
		/>
		{#if type === 'password'}
			<button
				type="button"
				onclick={() => (revealed = !revealed)}
				aria-label={revealed ? 'Hide password' : 'Show password'}
				aria-pressed={revealed}
				class="absolute inset-y-0 right-0 flex items-center px-3 text-muted transition hover:text-heading"
			>
				{#if revealed}
					<!-- eye-off -->
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-4.5">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M6.6 6.6C4.5 8 3 10 2 12c1.8 3.6 5.5 7 10 7 1.6 0 3.1-.4 4.5-1.1M9.9 4.2A10.4 10.4 0 0 1 12 4c4.5 0 8.2 3.4 10 7-.5 1-1.1 2-1.9 2.9"
						/>
					</svg>
				{:else}
					<!-- eye -->
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-4.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M2 12c1.8-3.6 5.5-7 10-7s8.2 3.4 10 7c-1.8 3.6-5.5 7-10 7s-8.2-3.4-10-7Z" />
						<circle cx="12" cy="12" r="3" />
					</svg>
				{/if}
			</button>
		{/if}
	</div>
</label>
