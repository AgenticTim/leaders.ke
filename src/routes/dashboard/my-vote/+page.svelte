<script lang="ts">
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/Avatar.svelte';
	import LeaderCard from '$lib/components/LeaderCard.svelte';
	import EyeIcon from '$lib/components/svgs/EyeIcon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	// Pledges grouped by the seat they're for ("Governor, Nairobi County"), newest
	// pledge first within and across groups (data arrives newest first).
	const pledgeGroups = $derived.by(() => {
		const map = new Map<string, typeof data.pledges>();
		for (const pledge of data.pledges) {
			const seat = `${pledge.positionTitle}, ${pledge.region}`;
			const group = map.get(seat);
			if (group) group.push(pledge);
			else map.set(seat, [pledge]);
		}
		return [...map.entries()].map(([seat, items]) => ({ seat, items }));
	});
	const LEVEL_LABEL: Record<string, string> = {
		president: 'President',
		governor: 'Governor',
		senator: 'Senator',
		womanRep: 'Woman Rep',
		mp: 'MP',
		mca: 'MCA'
	};
</script>

<svelte:head><title>My Vote · vote.ke</title></svelte:head>

<div class="flex min-h-[70vh] flex-col">
<div>

	<div class="mt-4 flex flex-col sm:flex-row items-center justify-between">
		<h2 class="text-sm font-semibold text-heading">Simulations</h2>
		<p class="text-sm italic text-muted">My voting practice sessions</p>
	</div>

	{#if data.ballots.length > 0}
		<!-- One row per saved simulation, one column per seat level: a cell is the
		actual candidate that simulation picked (live data, same as the share page),
		so scanning down a column compares how your picks changed across ballots. -->
		<div class="mt-2 overflow-x-auto rounded-2xl border border-border">
			<table class="w-full min-w-3xl border-collapse text-sm">
				<thead>
					<tr class="bg-surface-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
						<th class="p-3 font-semibold">Region</th>
						{#each data.ballots[0].results as { level } (level)}
							<th class="p-3 font-semibold ">{LEVEL_LABEL[level]}</th>
						{/each}
						<th class="p-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each data.ballots as ballot (ballot.publicId)}
						<tr class="bg-surface">
							<td class="p-3 align-top">
								<p class="mt-1 text-xs text-muted">{dateFmt.format(new Date(ballot.createdAt))}</p>
								<a href="/ballot/{ballot.publicId}" class="text-xs text-muted hover:text-primary capitalize">
									{ballot.ward}, {ballot.constituency}, {ballot.county}
								</a>
							</td>
							{#each ballot.results as { level, candidate } (level)}
								<td class="p-3 align-top">
									{#if candidate}
										<a href={candidate.path} class="flex items-center gap-2 hover:text-primary">
											<Avatar name={candidate.name} initials={candidate.initials} photoUrl={candidate.photoUrl} sizeClass="size-8" textClass="text-xs" />
											<span class="min-w-0">
												<span class="block max-w-28 truncate text-xs font-medium text-heading">{candidate.name}</span>
												{#if candidate.party}<span class="block max-w-28 truncate text-[11px] text-muted">{candidate.party}</span>{/if}
											</span>
										</a>
									{:else}
										<span class="text-xs text-muted">-</span>
									{/if}
								</td>
							{/each}
							<td class="p-3 flex gap-2 items-center ">
									<a href="/ballot/{ballot.publicId}"
										aria-label="View this ballot"
										class="grid size-9 place-items-center rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-heading"
									>
										<EyeIcon/>
									</a>
								<form
									method="post"
									action="?/deleteBallot"
									use:enhance={({ cancel }) => {
										if (!confirm('Delete this simulated ballot? This cannot be undone.')) cancel();
									}}
								>
									<input type="hidden" name="publicId" value={ballot.publicId} />
									<button
										type="submit"
										aria-label="Delete this ballot"
										class="grid size-9 place-items-center rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-heading"
									>
										✕
									</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="mt-6 flex flex-col sm:flex-row items-center justify-between">
		<h2 class="text-sm font-semibold text-heading">My Pledges</h2>
		<p class="text-sm italic text-muted">Candidates I promise to vote for</p>
	</div>

	{#if data.pledges.length > 0}
		<!-- Grouped by seat, each candidate rendered with the same LeaderCard the
		directory pages (/presidents etc.) use, plus a pledged-date caption. -->
		{#each pledgeGroups as group (group.seat)}
			<h3 class="mt-5 text-xs font-semibold tracking-wide text-muted uppercase">
				<span class="capitalize">{group.seat}</span>
			</h3>
			<div class="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each group.items as pledge (pledge.path + pledge.pledgedAt)}
					<div>
						<LeaderCard
							path={pledge.path}
							name={pledge.leaderName}
							initials={pledge.initials}
							photoUrl={pledge.photoUrl}
							verified={pledge.verified}
							party={pledge.party}
							partyPath={pledge.partyPath}
							positionTitle={pledge.positionTitle}
							region={pledge.region}
							status={pledge.status}
							followers={pledge.followerCount}
						/>
						<p class="mt-1.5 px-1 text-xs text-muted">Pledged {dateFmt.format(new Date(pledge.pledgedAt))}</p>
					</div>
				{/each}
			</div>
		{/each}
	{:else}
		<div class="mt-4 rounded-2xl border border-dashed border-border p-8 text-center">
			<p class="font-semibold text-heading">No pledges yet</p>
			<p class="mx-auto mt-2 max-w-md text-sm text-muted">
				{data.ballots.length > 0
					? 'Pledge to a candidate from your ballot to see them here.'
					: "You haven't simulated your 2027 ballot yet."}
			</p>
			<a
				href="/"
				class="mt-3 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
			>
				Hit the ballot
			</a>
		</div>
	{/if}
</div>

<!-- Claim your profile: pinned to the bottom of the page even when there's little content above. -->
<div class="mt-8 lg:mt-auto pt-8 rounded-3xl bg-primary p-6 text-center text-on-primary">
	<h2 class="text-lg font-bold text-on-primary">For Leaders and Campaign Managers</h2>
	<p class="mt-2 text-sm text-on-primary/80">
		Are you a Leader, Aspirant or Managing a Leader's PR or campaign?<br/>
		Launch your public page and manage your PR and campaigns here.
	</p>
	<a
		href="/onboard/profile"
		class="mt-4 inline-block rounded-full bg-surface px-5 py-2.5 text-sm font-semibold text-heading transition hover:bg-surface-2"
	>
		Create Your Profile
	</a>
</div>
</div>
