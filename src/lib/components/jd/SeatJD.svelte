<script lang="ts">
	// Drop-in "What does a <seat> do?" trigger + modal, reusable on any page
	// (directories, seat hubs, leader profiles…). The per-seat named wrappers
	// (PresidentJD, GovernorJD, …) pin the title; this generic one also accepts
	// any position title at runtime (e.g. a profile page's leader.positionTitle)
	// and renders nothing when no job description exists for it.
	import Modal from '$lib/components/Modal.svelte';
	import SeatDutiesContent from '$lib/components/jd/SeatDutiesContent.svelte';
	import { SEAT_DUTIES_BY_TITLE } from '$lib/data/seatDuties';
	import { SRC_PAY_BY_TITLE, SRC_EFFECTIVE } from '$lib/data/srcPay';

	let {
		title,
		label,
		triggerClass = 'text-sm font-medium text-primary hover:underline'
	}: {
		/** Position title key, same as srcPay/seatHub: President, Governor, Senator, Woman Rep, MP, MCA. */
		title: string;
		/** Trigger text; defaults to "What does a <title> do?" */
		label?: string;
		triggerClass?: string;
	} = $props();

	const duties = $derived(SEAT_DUTIES_BY_TITLE[title] ?? null);
	const pay = $derived(SRC_PAY_BY_TITLE[title] ? { ...SRC_PAY_BY_TITLE[title], source: SRC_EFFECTIVE } : null);
	// "an MP", "an MCA" — initialisms read with a vowel sound.
	const article = $derived(title === 'MP' || title === 'MCA' ? 'an' : 'a');
	let open = $state(false);
</script>

{#if duties}
	<button type="button" onclick={() => (open = true)} class={triggerClass}>
		{label ?? `What does ${article} ${title} do?`}
	</button>
	<Modal bind:open title="Job Description: {title}" maxWidthClass="max-w-3xl">
		<SeatDutiesContent {duties} {pay} />
	</Modal>
{/if}
