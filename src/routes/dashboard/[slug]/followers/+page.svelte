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

	// Bar length is relative to the area with the most pledges (a raw-count
	// "where the volume is" read); color intensity is relative to pledge RATE
	// against that area's real 2022 electorate (a "how deep does it run"
	// read) — the two together are what "graphically show pledges/potential
	// voters per region" actually needs, not just a bare number list. The
	// rows are the seat's own wards when the seat sits within one county
	// (data.wardHeat), else the national county map.
	const heatRows = $derived(
		data.wardHeat ?? data.heatmap.map((r) => ({ area: r.county, pledges: r.pledges, registeredVoters: r.registeredVoters }))
	);
	const maxPledges = $derived(Math.max(1, ...heatRows.map((r) => r.pledges)));
	const maxRate = $derived(Math.max(0.0001, ...heatRows.map((r) => (r.registeredVoters ? r.pledges / r.registeredVoters : 0))));
	function barWidth(row: (typeof heatRows)[number]): number {
		return Math.round((row.pledges / maxPledges) * 100);
	}
	function heatOpacity(row: (typeof heatRows)[number]): number {
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
		<p class="mt-1 text-sm text-muted">
			{#if data.wardHeat}
				Where your vote pledges concentrate, ward by ward across your seat's own ground in {data.wardScopeCounty}.
			{:else}
				Where your vote pledges concentrate, against each county's 2022 electorate.
			{/if}
		</p>

		<!-- Votes-to-win benchmark (rough by design: ~65% turnout, two-horse
		split — the label says so) plus penetration against the seat's own
		electorate. -->
		{#if data.seatStats}
			<div class="mt-4 grid grid-cols-3 gap-3">
				<div class="rounded-2xl bg-surface-2 p-3">
					<p class="text-xs text-muted">Seat electorate (2022)</p>
					<p class="mt-0.5 text-lg font-extrabold tabular-nums text-heading">{numFmt.format(data.seatStats.electorate)}</p>
				</div>
				<div class="rounded-2xl bg-surface-2 p-3">
					<p class="text-xs text-muted">Votes to win (est.)</p>
					<p class="mt-0.5 text-lg font-extrabold tabular-nums text-heading">{numFmt.format(data.seatStats.votesToWin)}</p>
				</div>
				<div class="rounded-2xl bg-surface-2 p-3">
					<p class="text-xs text-muted">Pledge coverage</p>
					<p class="mt-0.5 text-lg font-extrabold tabular-nums text-primary">{pctFmt.format(data.seatStats.coverage)}</p>
				</div>
			</div>
			<p class="mt-1.5 text-xs text-muted">
				"Votes to win" assumes ~{Math.round(data.seatStats.turnoutAssumption * 100)}% turnout and a two-way race — a planning benchmark, not a prediction.
			</p>
		{/if}

		<!-- Opportunity ranking: the biggest pools of voters not yet reached. -->
		{#if data.opportunities.length > 0}
			<div class="mt-4">
				<p class="text-sm font-semibold text-heading">Where to take your next campaign</p>
				<ol class="mt-2 space-y-1.5">
					{#each data.opportunities as opp, i (opp.area)}
						<li class="flex items-baseline justify-between gap-3 text-sm">
							<span><span class="mr-1.5 text-xs font-bold text-primary">{i + 1}</span>{opp.area}</span>
							<span class="shrink-0 text-xs tabular-nums text-muted">{numFmt.format(opp.untapped)} voters untapped · {numFmt.format(opp.pledges)} pledge{opp.pledges === 1 ? '' : 's'}</span>
						</li>
					{/each}
				</ol>
			</div>
		{/if}

		<!-- One bar per area (the seat's wards, or all 47 counties nationally —
		even at 0 pledges, so the map reads as "here's the ground, here's how
		much of it you've reached" from day one). Bar LENGTH is this area's
		share of pledges relative to your top area (where the raw volume is);
		bar COLOR intensity is pledge rate against its registered voters (how
		deep it runs there) — an area can be short-but-dark (few pledges, high
		rate in a small electorate) or long-but-pale (many pledges, thin
		against a big one). -->
		<ul class="mt-4 max-h-100 space-y-2.5 overflow-y-auto pr-1">
			{#each heatRows as row (row.area)}
				<li>
					<div class="flex items-baseline justify-between gap-3 text-sm">
						<span class="font-medium text-heading">{row.area}</span>
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
