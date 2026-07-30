<script lang="ts">
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import SignupForm from '$lib/components/auth/SignupForm.svelte';
	import VerifyOtpForm from '$lib/components/auth/VerifyOtpForm.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Same in-place verify step AuthModal uses (SignupForm's onVerifyEmail):
	// the signup action's redirect to /verify/email is intercepted client-side
	// and shown as an overlay instead of navigating there, so completing the
	// code lands straight on `next` (e.g. /onboard/profile) rather than a
	// separate full-page verify screen first.
	let verifyOpen = $state(false);
	let verifyEmail = $state('');
	function onVerifyEmail(email: string) {
		verifyEmail = email;
		verifyOpen = true;
	}
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

	<SignupForm next={data.next} googleEnabled={data.googleEnabled} lockedEmail={data.lockedEmail} {onVerifyEmail} />

	{#snippet footer()}
		Already have an account?
		<a href="/login?next={encodeURIComponent(data.next)}" class="font-semibold text-primary hover:underline">
			Sign in
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
