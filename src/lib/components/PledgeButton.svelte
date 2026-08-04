<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AuthModal from '$lib/components/auth/AuthModal.svelte';

	// One-click pledge to a candidate, posting to the host page's own "?/pledge"
	// action. Pledging requires a logged-in account: a guest gets the auth modal
	// (back to this same page after) instead of the form.
	let {
		campaignId,
		candidateName,
		isPledged = false,
		signedIn = false,
		wide = false
	}: {
		campaignId: number;
		candidateName: string;
		/** Server-resolved existing pledge (survives a refresh, unlike justPledged). */
		isPledged?: boolean;
		signedIn?: boolean;
		/** Card variant: full-width filled button (e.g. the campaign sidebar),
		 * instead of the compact ballot-row pill. */
		wide?: boolean;
	} = $props();

	let authOpen = $state(false);
	let justPledged = $state(false);
	const pledged = $derived(isPledged || justPledged);
	let pledging = $state(false);
	const firstName = $derived(candidateName.split(/\s+/)[0]);
	
	// Landed back here signed in after the auth-modal detour (?pledge=<campaignId>
	// rode along on `next`), finish the pledge automatically instead of making
	// them click again, then clean the URL. Same resume idiom as FollowButton.
	let pledgeFormEl: HTMLFormElement | undefined = $state();
	$effect(() => {
		if (page.url.searchParams.get('pledge') !== String(campaignId) || !signedIn) return;
		if (!pledged) pledgeFormEl?.requestSubmit();
		goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
	});

	const buttonClass = $derived(
		`rounded-full font-semibold transition disabled:opacity-60 ${
			wide
				? 'w-full bg-primary px-4 py-2.5 text-on-primary hover:brightness-95'
				: 'border border-primary px-3 py-1 text-xs text-primary hover:bg-primary hover:text-on-primary'
		}`
	);
	
</script>

{#if pledged}
	<p
		class="rounded-full border border-primary/40 bg-primary-soft text-center font-semibold text-on-primary {wide
			? 'px-4 py-2.5'
			: 'px-3 py-1 text-xs'}"
	>
		Pledged ✓
	</p>
{:else if signedIn}
	<form
		method="post"
		action="?/pledge"
		bind:this={pledgeFormEl}
		use:enhance={() => {
			pledging = true;
			return async ({ result, update }) => {
				pledging = false;
				if (result.type === 'success') justPledged = true;
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="campaignId" value={campaignId} />
		<button type="submit" disabled={pledging} aria-label="Pledge to vote for {candidateName}" class={buttonClass}>
			{pledging ? 'Pledging…' : "I'll Vote " + firstName}
		</button>
	</form>
{:else}
	<button
		type="button"
		onclick={() => (authOpen = true)}
		aria-label="Log in to pledge to vote for {candidateName}"
		class={buttonClass}
	>
		I'll Vote {firstName}
	</button>
	<AuthModal
		bind:open={authOpen}
		next="{page.url.pathname}?pledge={campaignId}"
		message="Log in to pledge your 2027 vote to {candidateName}."
	/>
{/if}
