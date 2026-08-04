<script lang="ts">
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import LoginForm from '$lib/components/auth/LoginForm.svelte';
	import VerifyOtpForm from '$lib/components/auth/VerifyOtpForm.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Same in-place verify step as /signup: an unverified account logging in is
	// redirected to /verify/email by the server action, intercepted here and
	// shown as an overlay instead of navigating to a separate page.
	let verifyOpen = $state(false);
	let verifyEmail = $state('');
	function onVerifyEmail(email: string) {
		verifyEmail = email;
		verifyOpen = true;
	}
</script>

<AuthCard title="Welcome back"
	subtitle={data.notice ? data.notice : "Sign in to your vote.ke account"}>
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
		{onVerifyEmail}
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

<Modal bind:open={verifyOpen} title="Verify your email">
	<p class="mt-3 text-sm text-muted">
		Enter the code we sent to <span class="font-semibold text-heading">{verifyEmail}</span> to continue.
	</p>
	<div class="mt-5">
		<VerifyOtpForm destination={verifyEmail} next={data.next} autoSend onVerified={() => (verifyOpen = false)} />
	</div>
</Modal>
