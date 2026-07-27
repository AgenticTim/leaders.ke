<script lang="ts">
	import GeoSelect from '$lib/components/GeoSelect.svelte';
	import { counties, findCountyBySlug, findConstituencyBySlug, findWardBySlug } from '$lib/data/geo';

	// Honest helper: the IEBC has no public lookup API, so we point to the official
	// channels and show the visitor their area's register stats from the 2022 roll.
	let county = $state('');
	let constituency = $state('');
	let ward = $state('');

	const pickedCounty = $derived(county ? findCountyBySlug(county) : undefined);
	const pickedConstituency = $derived(constituency ? findConstituencyBySlug(constituency) : undefined);
	const pickedWard = $derived(ward ? findWardBySlug(ward) : undefined);

	const fmt = new Intl.NumberFormat('en-KE');
	const nationalVoters = counties.reduce((sum, c) => sum + c.voters, 0);
</script>

<svelte:head>
	<title>Check your voter registration — vote.ke</title>
	<meta name="description" content="How to verify your IEBC voter registration status by SMS or online, plus registered-voter stats for your area." />
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
	<h1 class="text-3xl font-bold text-heading">Check your registration</h1>
	<p class="mt-2 text-base">
		Only the IEBC holds the voters' roll — vote.ke cannot look up individuals, and no third-party
		site should ask for your ID number. Use the official channels:
	</p>

	<div class="mt-6 grid gap-4 sm:grid-cols-2">
		<div class="rounded-2xl border border-border bg-surface p-5">
			<h2 class="font-semibold text-heading">By SMS</h2>
			<p class="mt-2 text-sm">
				Send your national ID number to the IEBC short code (<span class="font-semibold">70000</span>
				in past elections — confirm the current code on iebc.or.ke). The reply shows your
				registration details and polling station.
			</p>
		</div>
		<div class="rounded-2xl border border-border bg-surface p-5">
			<h2 class="font-semibold text-heading">Online or in person</h2>
			<p class="mt-2 text-sm">
				Use the official portal at
				<a href="https://verify.iebc.or.ke" class="font-medium text-primary hover:underline">verify.iebc.or.ke</a>,
				or visit your constituency's IEBC office with your ID.
			</p>
		</div>
	</div>

	<h2 class="mt-12 text-xl font-semibold text-heading">Registered voters in your area</h2>
	<p class="mt-1 text-sm text-muted">
		From the IEBC's 2022 register — {fmt.format(nationalVoters)} registered voters nationally. Pick
		your area to see its numbers.
	</p>

	<div class="mt-4">
		<GeoSelect bind:county bind:constituency bind:ward />
	</div>

	{#if pickedCounty}
		<div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="rounded-2xl border border-border bg-surface p-5">
				<p class="text-sm text-muted">{pickedCounty.name} County</p>
				<p class="mt-1 text-2xl font-bold text-heading">{fmt.format(pickedCounty.voters)}</p>
				<p class="text-xs text-muted">registered voters (2022)</p>
			</div>
			{#if pickedConstituency}
				<div class="rounded-2xl border border-border bg-surface p-5">
					<p class="text-sm text-muted">{pickedConstituency.name} Constituency</p>
					<p class="mt-1 text-2xl font-bold text-heading">{fmt.format(pickedConstituency.voters)}</p>
					<p class="text-xs text-muted">registered voters (2022)</p>
				</div>
			{/if}
			{#if pickedWard}
				<div class="rounded-2xl border border-border bg-surface p-5">
					<p class="text-sm text-muted">{pickedWard.name} Ward</p>
					<p class="mt-1 text-2xl font-bold text-heading">{fmt.format(pickedWard.voters)}</p>
					<p class="text-xs text-muted">registered voters (2022)</p>
				</div>
			{/if}
		</div>
		<p class="mt-4 text-sm text-muted">
			Every one of those votes was someone who showed up. Yours is next —
			<a href="/education/how-to-register" class="font-medium text-primary hover:underline">here's how to register</a>.
		</p>
	{/if}
</section>
