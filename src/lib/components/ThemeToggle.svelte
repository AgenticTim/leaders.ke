<script lang="ts">
	import MoonIcon from "./svgs/MoonIcon.svelte";
	import SunIcon from "./svgs/SunIcon.svelte";

	// Reflects and flips the `.dark` class on <html>. Initial state is read from the DOM
	// so it stays in sync with the no-flash script in app.html.
	let dark = $state(false);

	$effect(() => {
		dark = document.documentElement.classList.contains('dark');
	});

	function toggle() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		try {
			localStorage.setItem('theme', dark ? 'dark' : 'light');
		} catch {
			// ignore storage failures (private mode)
		}
	}
</script>

<button
	type="button"
	onclick={toggle}
	aria-label="Toggle dark mode"
	aria-pressed={dark}
	class="grid size-9 place-items-center rounded-full border border-border bg-surface-2 text-heading transition hover:bg-surface-3 focus:ring-0 focus:ring-ring focus:outline-none"
>
	{#if dark}
		<!-- sun -->
		<SunIcon/>
	{:else}
		<!-- moon -->
		<MoonIcon/>
	{/if}
</button>
