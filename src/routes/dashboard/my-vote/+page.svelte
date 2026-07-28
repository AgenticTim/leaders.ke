<script lang="ts">
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/Avatar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const LEVEL_LABEL: Record<string, string> = {
		president: 'President',
		governor: 'Governor',
		senator: 'Senator',
		womanRep: 'Woman Rep',
		mp: 'MP',
		mca: 'MCA'
	};
</script>

<svelte:head><title>My Vote — vote.ke</title></svelte:head>

<div class="flex min-h-[70vh] flex-col">
<div>
	{#if data.ballots.length > 0}
		<h2 class="mt-4 text-sm font-semibold text-heading">Simulated votes</h2>
		<!-- One row per saved simulation, one column per seat level: a cell is the
		actual candidate that simulation picked (live data, same as the share page),
		so scanning down a column compares how your picks changed across ballots. -->
		<div class="mt-2 overflow-x-auto rounded-2xl border border-border">
			<table class="w-full min-w-3xl border-collapse text-sm">
				<thead>
					<tr class="bg-surface-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
						<th class="p-3 font-semibold">Region</th>
						{#each data.ballots[0].results as { level } (level)}
							<th class="p-3 font-semibold">{LEVEL_LABEL[level]}</th>
						{/each}
						<th class="p-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each data.ballots as ballot (ballot.publicId)}
						<tr class="bg-surface">
							<td class="p-3 align-top">
								<a href="/ballot/{ballot.publicId}" class="text-sm font-medium text-heading hover:text-primary">
									{ballot.ward}, {ballot.constituency}, {ballot.county}
								</a>
								<p class="mt-1 text-xs text-muted">{dateFmt.format(new Date(ballot.createdAt))}</p>
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
										<span class="text-xs text-muted">—</span>
									{/if}
								</td>
							{/each}
							<td class="p-3 align-top">
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
										class="rounded-md px-2 py-1 text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-heading"
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

	<h2 class="mt-6 text-sm font-semibold text-heading">Candidates I have pledged to vote for</h2>

	{#if data.pledges.length > 0}
		<ul class="mt-4 space-y-3">
			{#each data.pledges as pledge (pledge.path)}
				<li class="rounded-2xl border border-border bg-surface p-4">
					<a href={pledge.path} class="font-semibold text-heading hover:text-primary">
						{pledge.leaderName}
					</a>
					<p class="text-sm text-muted">{pledge.positionTitle}, {pledge.region}</p>
				</li>
			{/each}
		</ul>
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
