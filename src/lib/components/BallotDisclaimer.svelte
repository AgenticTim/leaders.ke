<script lang="ts">
	// Disclaimer for every simulated-ballot surface, per KDPA/IEBC-regulation
	// guidance. Sticky on the homepage booth (always in view over the wizard);
	// the /ballot share pages render it in normal flow at the end of the page.
	let { sticky = true }: { sticky?: boolean } = $props();
</script>

<div
	class="border-t border-border bg-surface-2 px-4 py-4 text-xs text-muted text-center flex flex-wrap flex-col sm:flex-row gap-1 justify-center sm:px-6 {sticky
		? 'sticky bottom-0 z-20'
		: ''}"
>
	<b>This is NOT an official IEBC ballot.</b>
	<span>It is meant for educational purposes only. </span>
	<span>No votes are registered, tallied or published. </span>
	<span>Visit <a href="https://www.iebc.or.ke" class="underline hover:text-heading" target="_blank">IEBC.or.ke</a>
	for official voting information. </span>
	<span>Your selection is kept private under KDPA 2019.</span> 
</div>
