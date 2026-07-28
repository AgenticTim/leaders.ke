<script lang="ts">
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import LoginForm from '$lib/components/auth/LoginForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<AuthCard title="Welcome back" subtitle="Sign in to your vote.ke account">
	{#if data.notice}
		<p class="mb-4 rounded-xl bg-primary-soft p-3 text-sm text-on-primary">{data.notice}</p>
	{/if}
	{#if data.inviteBanner}
		<p class="mb-4 rounded-xl bg-primary-soft p-3 text-sm text-on-primary">
			You've been invited by {data.inviteBanner.leaderName} to join as
			{data.inviteBanner.role === 'manager'
				? 'a manager'
				: data.inviteBanner.role === 'ambassador'
					? 'an ambassador'
					: 'a follower'}. Sign in to accept the invite.
		</p>
	{/if}

	<LoginForm
		next={data.next}
		googleEnabled={data.googleEnabled}
		lockedEmail={data.lockedEmail}
		initialEmail={data.devEmail}
		initialPassword={data.devPassword}
	/>

	{#snippet footer()}
		New here?
		<a
			href="/signup?next={encodeURIComponent(data.next)}"
			class="font-semibold text-primary hover:underline"
		>
			Create an account
		</a>
	{/snippet}
</AuthCard>
