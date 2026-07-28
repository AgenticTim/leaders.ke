<script lang="ts">
	import type { Snippet } from 'svelte';

	// Generic overlay dialog shell: backdrop, centered card, ✕/escape/backdrop
	// dismiss. Content comes in as a snippet (only rendered while open, so modal
	// bodies mount fresh on every open); hosts bind `open` to control it.
	let {
		open = $bindable(false),
		title,
		onclose,
		children
	}: {
		open?: boolean;
		title: string;
		/** Runs whenever the modal is dismissed (✕, escape, backdrop click). */
		onclose?: () => void;
		children: Snippet;
	} = $props();

	function close() {
		open = false;
		onclose?.();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) close();
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			class="my-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 text-left"
		>
			<div class="flex items-start justify-between gap-3">
				<h2 class="text-xl font-bold text-heading">{title}</h2>
				<button
					type="button"
					onclick={close}
					aria-label="Close"
					class="rounded-md px-2 py-1 text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-heading"
				>
					✕
				</button>
			</div>
			{@render children()}
		</div>
	</div>
{/if}
