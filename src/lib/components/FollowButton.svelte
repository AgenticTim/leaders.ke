<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AuthModal from '$lib/components/auth/AuthModal.svelte';

	// Signed-in-only follow: posts to the current page's own "?/follow" action
	// (see /[leader] and /[leader]/[year]'s server files) — no name/contact
	// capture or OTP confirm, the account itself is the proof. A guest gets the
	// auth modal (back to this same page after) instead of a form.
	let { candidateName, signedIn, isFollowing = false }: { candidateName: string; signedIn: boolean; isFollowing?: boolean } = $props();

	let authOpen = $state(false);

	const firstName = $derived(candidateName.split(/\s+/)[0]);

	let following = $state(false);
	let unfollowing = $state(false);
	// A fresh submit in this session counts immediately, even before the next
	// full reload re-confirms it server-side (isFollowing) — whichever is true wins,
	// except a just-unfollowed click overrides a stale isFollowing until reload.
	let justFollowed = $state(false);
	let justUnfollowed = $state(false);
	const followed = $derived((isFollowing || justFollowed) && !justUnfollowed);
	let followError = $state<string | null>(null);

	// Landed back here signed in after the auth-modal detour (?follow=1 rode along
	// on `next`) — finish the follow automatically instead of making them click
	// again, then clean the URL. Same resume idiom as the ballot page's ?save=1.
	let followFormEl: HTMLFormElement | undefined = $state();
	$effect(() => {
		if (page.url.searchParams.get('follow') !== '1' || !signedIn) return;
		if (!followed) followFormEl?.requestSubmit();
		goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
	});
</script>

<div class="rounded-3xl border border-border bg-surface p-6">

	{#if followed}
		<div class="flex items-baseline justify-between gap-2">
			<h2 class="text-lg font-bold text-heading">Following {firstName}</h2>
			<form
				method="post"
				action="?/unfollow"
				use:enhance={() => {
					unfollowing = true;
					followError = null;
					return async ({ result, update }) => {
						unfollowing = false;
						if (result.type === 'success') {
							justUnfollowed = true;
							justFollowed = false;
						}
						else if (result.type === 'failure') followError = String((result.data as { error?: string })?.error ?? 'Could not unfollow.');
						await update({ reset: false });
					};
				}}
			>
				<button
					type="submit"
					disabled={unfollowing}
					class="text-sm font-medium text-muted underline-offset-2 transition hover:text-heading hover:underline disabled:opacity-60"
				>
					{unfollowing ? 'Unfollowing…' : 'Unfollow'}
				</button>
			</form>
			{#if followError}
				<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{followError}</div>
			{/if}
		</div>
		<p class="mt-1 text-sm text-muted">You'll get updates from {firstName}'s campaign.</p>
	{:else if signedIn}
		<h2 class="text-lg font-bold text-heading">Follow {firstName}</h2>
		<p class="mt-1 text-sm text-muted">Get updates from {firstName}'s campaign.</p>
		{#if followError}
			<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{followError}</div>
		{/if}
		<form
			method="post"
			action="?/follow"
			class="mt-4"
			bind:this={followFormEl}
			use:enhance={() => {
				following = true;
				followError = null;
				return async ({ result, update }) => {
					following = false;
					if (result.type === 'success') {
						justFollowed = true;
						justUnfollowed = false;
					}
					else if (result.type === 'failure') followError = String((result.data as { error?: string })?.error ?? 'Could not follow.');
					await update({ reset: false });
				};
			}}
		>
			<button
				type="submit"
				disabled={following}
				class="w-full rounded-full bg-primary px-4 py-2.5 font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
			>
				{following ? 'Following…' : `Follow ${firstName}`}
			</button>
		</form>
	{:else}
		<h2 class="text-lg font-bold text-heading">Follow {firstName}</h2>
		<p class="mt-1 text-sm text-muted">Get updates from {firstName}'s campaign.</p>
		<button
			type="button"
			onclick={() => (authOpen = true)}
			class="mt-4 block w-full rounded-full border bg-primary px-4 py-2.5 text-center font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
		>
			Follow {firstName}
		</button>
		<AuthModal
			bind:open={authOpen}
			next="{page.url.pathname}?follow=1"
			message="Log in to follow {candidateName} and get campaign updates."
		/>
	{/if}
</div>
