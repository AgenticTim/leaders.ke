<script lang="ts">
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import SignupForm from '$lib/components/auth/SignupForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<AuthCard
	title="Create your account"
	subtitle={data.notice ? data.notice : data.ballotIntent ? 'And see how your leaders performed' : 'And simulate your 2027 vote'}
>
	{#if data.inviteBanner}
		<p class="mb-4 rounded-xl bg-primary-soft p-3 text-sm text-on-primary">
			You've been invited by {data.inviteBanner.leaderName} to join as
			{data.inviteBanner.role === 'manager'
				? 'a manager'
				: data.inviteBanner.role === 'ambassador'
					? 'an ambassador'
					: 'a follower'}. Create an account to accept the invite.
		</p>
	{/if}

	<SignupForm next={data.next} googleEnabled={data.googleEnabled} lockedEmail={data.lockedEmail} />

	{#snippet footer()}
		Already have an account?
		<a href="/login?next={encodeURIComponent(data.next)}" class="font-semibold text-primary hover:underline">
			Sign in
		</a>
	{/snippet}
</AuthCard>
