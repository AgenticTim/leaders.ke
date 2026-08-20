<script lang="ts">
	import LeaderProfile from '$lib/components/LeaderProfile.svelte';
	import { isRunStatus, seatTitlePhrase } from '$lib/utils/seat';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Qualified seat ("Former Governor, Siaya" / "Candidate for Senator, Nairobi"),
	// so a search result distinguishes an incumbent from someone who left the seat
	// or is only running for it. A sitting holder gets the bare seat.
	const seat = $derived(
		seatTitlePhrase(data.leader.status, data.leader.positionTitle, data.leader.regionLabel)
	);
	// Only promise a campaign to someone who actually has one; a former officeholder
	// who isn't running has a record to show and nothing else.
	const blurb = $derived(
		isRunStatus(data.leader.status)
			? 'verified record, track record and active campaign'
			: 'verified record and track record'
	);
</script>

<svelte:head>
	<title>{data.leader.name} · {seat} | vote.ke</title>
	<meta name="description" content="{data.leader.name}, {seat}: {blurb}." />
</svelte:head>

<LeaderProfile {data} {form} />
