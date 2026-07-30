<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import FollowersTable from '$lib/components/FollowersTable.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The public profile URL is where followers sign up; surfaced here for sharing.
	const publicPath = $derived(page.data.leaderContext?.publicPath ?? '/presidents');
	const county = $derived(page.data.leaderContext?.region ?? null);

	// Bar length is relative to the county with the most pledges (a raw-count
	// "where the volume is" read); color intensity is relative to pledge RATE
	// against that county's real 2022 electorate (a "how deep does it run"
	// read) — the two together are what "graphically show pledges/potential
	// voters per region" actually needs, not just a bare number list.
	const maxPledges = $derived(Math.max(1, ...data.heatmap.map((r) => r.pledges)));
	const maxRate = $derived(Math.max(0.0001, ...data.heatmap.map((r) => (r.registeredVoters ? r.pledges / r.registeredVoters : 0))));
	function barWidth(row: (typeof data.heatmap)[number]): number {
		return Math.round((row.pledges / maxPledges) * 100);
	}
	function heatOpacity(row: (typeof data.heatmap)[number]): number {
		const rate = row.registeredVoters ? row.pledges / row.registeredVoters : 0;
		return 0.25 + 0.75 * (rate / maxRate);
	}
	const pctFmt = new Intl.NumberFormat('en-KE', { style: 'percent', maximumFractionDigits: 3 });
	const numFmt = new Intl.NumberFormat('en-KE');

	function onWardChange(event: Event) {
		const ward = (event.target as HTMLSelectElement).value;
		goto(ward ? `?ward=${encodeURIComponent(ward)}` : '?', { keepFocus: true });
	}
</script>

<svelte:head><title>Followers — vote.ke</title></svelte:head>

{#if form?.invited}
	<div class="mb-6 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">
		Invite sent to {form.invited.email}
	</div>
{:else if form?.added}
	<div class="mb-6 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">
		{form.added.name} now follows this campaign.
	</div>
{:else if form?.error}
	<div class="mb-6 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">
		{form.error}
	</div>
{/if}

<!-- Invite someone to follow directly, not just via the public page. -->
<form method="post" action="?/inviteFollower" class="flex flex-wrap gap-2" use:enhance>
	<input
		type="email"
		name="email"
		required
		placeholder="Invite someone to follow, by email"
		class="min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
	/>
	<button
		type="submit"
		class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
	>
		Send invite
	</button>
</form>

{#if data.followerInvites.length > 0}
	<ul class="mt-3 space-y-2">
		{#each data.followerInvites as invite (invite.id)}
			<li class="rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-muted">Invited: {invite.email}</li>
		{/each}
	</ul>
{/if}

<div class="mt-6 flex flex-wrap items-end justify-between gap-4">
	<div>
		<h2 class="text-lg font-semibold text-heading">
			Followers <span class="text-sm font-normal text-muted">({data.total})</span>
		</h2>
		<p class="mt-1 text-sm text-muted">{data.newThisWeek} joined this week.</p>
	</div>

	{#if data.wards.length > 0}
		<select
			value={data.ward ?? ''}
			onchange={onWardChange}
			aria-label="Filter by ward"
			class="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
		>
			<option value="">All wards</option>
			{#each data.wards as w (w)}
				<option value={w}>{w}</option>
			{/each}
		</select>
	{/if}
</div>

{#if data.total === 0}
	<!-- The add-a-citizen form below stays available: manual recruitment is how a
	roster gets its first rows. -->
	<div class="mt-6 rounded-2xl border border-dashed border-border p-8 text-center">
		<p class="font-semibold text-heading">No followers yet</p>
		<p class="mx-auto mt-2 max-w-md text-sm text-muted">
			Citizens follow you from your public page with just a name and phone or email. Share your
			link everywhere: posters, WhatsApp groups, radio mentions. You can also add citizens
			yourself below.
		</p>
		<a
			href={publicPath}
			class="mt-4 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95"
		>
			Open your public page
		</a>
	</div>
{/if}

<div class="mt-6">
	<FollowersTable
		followers={data.followers}
		total={data.total}
		page={data.page}
		pageSize={data.pageSize}
		pagerHref={(p) => (data.ward ? `?ward=${encodeURIComponent(data.ward)}&page=${p}` : `?page=${p}`)}
		{county}
	/>
</div>


<!-- Voter Heatmap (Dominate perk): pledges by county against the real 2022
electorate; a locked tier gets an upsell instead of the bars, same pattern as
the Competitors tab's Sentiment Intelligence Suite banner. -->
<div class="mt-6 rounded-2xl border border-border bg-surface p-5">
	<p class="font-semibold text-heading">
		Voter heatmap <span class="text-sm font-normal text-muted">({data.pledgeCount} pledge{data.pledgeCount === 1 ? '' : 's'})</span>
	</p>
	{#if data.heatmapUnlocked}
		<p class="mt-1 text-sm text-muted">Where your vote pledges concentrate, against each county's 2022 electorate.</p>
		<!-- One bar per county (all 47, real 2022 electorate — even at 0
		pledges, so the map reads as "here's the ground, here's how much of it
		you've reached" from day one). Bar LENGTH is this county's share of
		pledges relative to your top county (where the raw volume is); bar
		COLOR intensity is pledge rate against that county's registered voters
		(how deep it runs there) — a county can be short-but-dark (few pledges,
		high rate in a small electorate) or long-but-pale (many pledges, thin
		against a big one). -->
		<ul class="mt-4 max-h-100 space-y-2.5 overflow-y-auto pr-1">
			{#each data.heatmap as row (row.county)}
				<li>
					<div class="flex items-baseline justify-between gap-3 text-sm">
						<span class="font-medium text-heading">{row.county}</span>
						<span class="shrink-0 text-xs text-muted">
							{numFmt.format(row.pledges)} pledge{row.pledges === 1 ? '' : 's'}
							{#if row.registeredVoters}
								<span class="text-muted"> · {pctFmt.format(row.pledges / row.registeredVoters)} of {numFmt.format(row.registeredVoters)} voters</span>
							{/if}
						</span>
					</div>
					<div class="mt-1 h-3 w-full overflow-hidden rounded-full bg-surface-2">
						<div
							class="h-full rounded-full bg-primary"
							style="width: {barWidth(row)}%; opacity: {heatOpacity(row)}"
						></div>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="mt-4 rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
			<a href="/pricing" class="font-semibold font-medium text-primary hover:underline">Upgrade to the Dominate Package</a> to see
			where your vote pledges concentrate, county by county, against the real electorate.
		</div>
	{/if}
</div>
