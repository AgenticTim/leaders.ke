<script lang="ts">
	import { page } from '$app/state';
	import LoginForm from './LoginForm.svelte';
	import SignupForm from './SignupForm.svelte';

	// Log in / Sign up as a modal, so auth becomes a transitional step inside a
	// flow (follow a campaign, save a simulated vote, pledge…) instead of a
	// navigation away from it. On success the shared forms' own /login|/signup
	// actions redirect to `next` — point it back at the host page (with whatever
	// intent param resumes the pending action, e.g. ?save=1) and the flow
	// continues where it left off. Google is a full-page OAuth round-trip either
	// way; `next` still brings them back.
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

	let mode = $state<'login' | 'signup'>('login');

	const googleEnabled = $derived(!!page.data.googleEnabled);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label={mode === 'login' ? 'Sign in' : 'Create your account'}
			class="my-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 text-left"
		>
			<div class="flex items-start justify-between gap-3">
				<h2 class="text-xl font-bold text-heading">
					{mode === 'login' ? 'Welcome back' : 'Create your account'}
				</h2>
				<button
					type="button"
					onclick={() => (open = false)}
					aria-label="Close"
					class="rounded-md px-2 py-1 text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-heading"
				>
					✕
				</button>
			</div>
			{#if message}
				<p class="mt-3 rounded-xl bg-primary-soft p-3 text-sm text-on-primary">{message}</p>
			{/if}

			<div class="mt-5">
				{#if mode === 'login'}
					<LoginForm {next} {googleEnabled} />
				{:else}
					<SignupForm {next} {googleEnabled} />
				{/if}
			</div>

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
		</div>
	</div>
{/if}
