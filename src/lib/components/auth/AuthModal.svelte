<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Modal from '$lib/components/Modal.svelte';
	import LoginForm from './LoginForm.svelte';
	import SignupForm from './SignupForm.svelte';
	import VerifyOtpForm from './VerifyOtpForm.svelte';

	// Log in / Sign up as a modal, so auth becomes a transitional step inside a
	// flow (follow a campaign, save a simulated vote, pledge…) instead of a
	// navigation away from it. An email signup/login that still needs email
	// verification stays in the overlay too: the /login|/signup action's redirect
	// to /verify/email is intercepted (onVerifyEmail) and swapped for the verify
	// step in place, so the whole auth+verify+resume chain never leaves the host
	// page. Only the verify step's own success redirect points at `next` (with
	// whatever intent param resumes the pending action, e.g. ?save=1). Google is
	// a full-page OAuth round-trip either way; `next` still brings them back.
	let {
		open = $bindable(false),
		next = '/dashboard',
		message = ''
	}: {
		open?: boolean;
		next?: string;
		// Why they're being asked to log in ("Log in to follow Wanjiku…") — shown
		// above the form so the modal never feels like a dead-end wall.
		message?: string;
	} = $props();

	let mode = $state<'login' | 'signup' | 'verify'>('login');
	let verifyEmail = $state('');

	const googleEnabled = $derived(!!page.data.googleEnabled);
	const title = $derived(
		mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Verify your email'
	);

	// The auth action already set the session cookie, but page data is deliberately
	// NOT refreshed here: the host's signed-out branch owns this modal, and
	// invalidating would unmount it mid-verify. The verify step's success redirect
	// (back to `next`) refreshes everything at the end.
	function toVerify(email: string) {
		verifyEmail = email;
		mode = 'verify';
	}

	// Bailing out of the verify step still leaves them signed in: refresh the
	// host page so it stops showing signed-out UI.
	function onclose() {
		if (mode === 'verify') invalidateAll();
	}
</script>

<Modal bind:open {title} {onclose}>
	{#if mode === 'verify'}
		<p class="mt-3 text-sm text-muted">
			Enter the code we sent to <span class="font-semibold text-heading">{verifyEmail}</span> to continue.
		</p>
	{:else if message}
		<p class="mt-3 rounded-xl bg-primary-soft p-3 text-sm text-on-primary">{message}</p>
	{/if}

	<div class="mt-5">
		{#if mode === 'login'}
			<LoginForm {next} {googleEnabled} onVerifyEmail={toVerify} />
		{:else if mode === 'signup'}
			<SignupForm {next} {googleEnabled} onVerifyEmail={toVerify} />
		{:else}
			<VerifyOtpForm destination={verifyEmail} {next} autoSend onVerified={() => (open = false)} />
		{/if}
	</div>

	{#if mode !== 'verify'}
		<div class="mt-6 border-t border-border pt-4 text-center text-sm text-muted">
			{#if mode === 'login'}
				New here?
				<button type="button" onclick={() => (mode = 'signup')} class="font-semibold text-primary hover:underline">
					Create an account
				</button>
			{:else}
				Already have an account?
				<button type="button" onclick={() => (mode = 'login')} class="font-semibold text-primary hover:underline">
					Sign in
				</button>
			{/if}
		</div>
	{/if}
</Modal>
