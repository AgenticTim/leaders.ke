<script lang="ts">
	// President job description trigger + modal (see SeatJD.svelte).
	import SeatJD from '$lib/components/jd/SeatJD.svelte';

	let { label, triggerClass }: { label?: string; triggerClass?: string } = $props();
</script>

<SeatJD title="President" {label} {triggerClass} />
