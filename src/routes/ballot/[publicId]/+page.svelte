<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/components/Avatar.svelte';
	import AuthModal from '$lib/components/auth/AuthModal.svelte';
	import FollowCard from '$lib/components/FollowCard.svelte';
	import PledgeButton from '$lib/components/PledgeButton.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import WhatsAppShareButton from '$lib/components/WhatsAppShareButton.svelte';
	import type { BallotLevel } from '$lib/server/ballot';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const LEVEL_LABEL: Record<BallotLevel, string> = {
		president: 'President',
		governor: 'Governor',
		senator: 'Senator',
		womanRep: 'Woman Representative',
		mp: 'Member of Parliament',
		mca: 'Member of County Assembly'
	};

	function campaignIdOf(candidateId: string): number | null {
		if (!candidateId.startsWith('campaign:')) return null;
		const id = Number(candidateId.slice('campaign:'.length));
		return Number.isInteger(id) ? id : null;
	}

	// Landed back here signed in after the signup detour (see the saveVote action).
	// If the account picked this ballot up on its own (anon_id matched, so it's
	// already theirs), just clean the URL; otherwise finish saving automatically
	// instead of making them click again.
	let saveVoteForm: HTMLFormElement | undefined = $state();
	let authOpen = $state(false);
	$effect(() => {
		if (page.url.searchParams.get('save') !== '1' || !page.data.user) return;
		if (data.isOwnBallot) goto(`/ballot/${data.publicId}`, { replaceState: true, keepFocus: true, noScroll: true });
		else saveVoteForm?.requestSubmit();
	});
</script>

<svelte:head>
	<title>My 2027 simulated ballot — vote.ke</title>
	<meta
		name="description"
		content="See who I'd vote for in the 2027 General Election, then simulate your own ballot on vote.ke."
	/>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
	<div class="text-center">
		<span
			class="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-on-primary"
		>
			Simulated ballot
		</span>
		<h1 class="mt-3 text-2xl font-bold text-heading sm:text-3xl">My 2027 Ballot</h1>
		<p class="mt-1 text-sm text-muted">
			{data.wardName}, {data.constituencyName}, {data.countyName}
		</p>
	</div>

	<!-- Ballot card: no voter name/contact/location-below-ward is ever rendered here -->
	<div class="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
		{#each data.results as { level, candidate } (level)}
			<div class="flex items-center gap-4 p-4 sm:p-5">
				{#if candidate}
					<Avatar name={candidate.name} initials={candidate.initials} photoUrl={candidate.photoUrl} sizeClass="size-14" textClass="text-sm" />
				{:else}
					<span class="grid size-14 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold text-muted">—</span>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold tracking-wide text-muted uppercase">
						{LEVEL_LABEL[level]}
					</p>
					{#if candidate}
						<p class="truncate font-semibold text-heading">
							<a href={candidate.path} class="hover:text-primary">{candidate.name}</a>
						</p>
						{#if candidate.party}<p class="text-xs text-muted">{candidate.party}</p>{/if}
					{:else}
						<p class="text-sm text-muted">No selection</p>
					{/if}
				</div>
				{#if candidate}
					{@const campaignId = campaignIdOf(candidate.candidateId)}
					<!-- Pledge and Follow the candidate you just picked. -->
					<div class="flex shrink-0 flex-col sm:flex-row items-center gap-2">
						{#if campaignId}
							<PledgeButton
									{campaignId}
									candidateName={candidate.name}
									isPledged={data.pledgedCampaignIds.includes(campaignId)}
									signedIn={!!page.data.user}
								/>
						{/if}
						<FollowCard
							candidateName={candidate.name}
							candidateId={candidate.candidateId}
							county={data.countyName}
							ward={data.wardName}
							compact
						/>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="mt-10 flex flex-col items-center gap-3 text-center">
		<div class="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
			{#if data.isOwnBallot}
				<a href="/dashboard/my-vote" class="text-sm font-medium text-primary hover:underline">✓ Simulation Saved</a>
			{:else if page.data.user}
				<form method="post" action="?/saveVote" bind:this={saveVoteForm} use:enhance>
					<button
						type="submit"
						class="rounded-full bg-primary px-4 py-2 font-semibold text-on-primary transition hover:brightness-95"
					>
						Save My Vote
					</button>
				</form>
			{:else}
				<a href="/" class="rounded-full bg-primary px-4 py-2 font-semibold text-on-primary transition hover:brightness-95">Simulate Your Vote</a>
				<AuthModal
					bind:open={authOpen}
					next="/ballot/{data.publicId}?save=1"
					message="Create an account to save this ballot and see how your leaders perform."
				/>
			{/if}
			<ShareButton title="My 2027 simulated ballot on vote.ke" />
			<WhatsAppShareButton text="I'll vote for these leaders in 2027:" />
		</div>
		<p class="mt-4 max-w-3xl text-xs text-muted">
			This is a simulated voting experience for the 2027 General Election. It is not an official
			ballot, does not register any vote, and results are never tallied or published per candidate.
			Data is handled under the Kenya Data Protection Act (2019). For official voter information,
			visit the <a href="https://www.iebc.or.ke" class="underline hover:text-heading">IEBC</a>.
		</p>
	</div>
</div>
