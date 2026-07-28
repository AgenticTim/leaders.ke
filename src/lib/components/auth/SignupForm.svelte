<script lang="ts">
	import { dev } from '$app/environment';
	import { applyAction, enhance } from '$app/forms';
	import Field from './Field.svelte';
	import GoogleButton from './GoogleButton.svelte';
	import Submit from './Submit.svelte';

	// The signup form body, shared by the /signup page and AuthModal (embedded on
	// any page as a transitional step before follow/save-vote/etc). Every action
	// posts to absolute /signup paths, never the host page's own query string —
	// errors are captured locally so the component behaves identically wherever
	// it's mounted. Email signups still detour through /verify/email before `next`.
	let {
		next = '/dashboard',
		googleEnabled = false,
		lockedEmail = null
	}: {
		next?: string;
		googleEnabled?: boolean;
		lockedEmail?: string | null;
	} = $props();

	// Dev convenience only — never prefilled in a production build.
	let firstName = $state(dev ? 'X' : '');
	let otherNames = $state(dev ? 'Test' : '');
	let email = $state(lockedEmail ?? (dev ? 'x@vote.ke' : ''));
	let password = $state(dev ? '2027-08-10' : '');

	let message = $state<string | null>(null);
	let submitting = $state(false);
</script>

{#if googleEnabled}
	<GoogleButton label="Sign up with Google" {next} action="/signup?/google" />
	<div class="my-5 flex items-center gap-3 text-xs text-muted">
		<span class="h-px flex-1 bg-border"></span>
		or
		<span class="h-px flex-1 bg-border"></span>
	</div>
{/if}

<form
	method="post"
	action="/signup?/email"
	class="space-y-4"
	use:enhance={() => {
		submitting = true;
		message = null;
		return async ({ result }) => {
			submitting = false;
			if (result.type === 'failure') message = String((result.data as { message?: string })?.message ?? 'Registration failed');
			else await applyAction(result);
		};
	}}
>
	<input type="hidden" name="next" value={next} />
	{#if lockedEmail}<input type="hidden" name="lockedEmail" value={lockedEmail} />{/if}
	<div class="grid grid-cols-2 gap-3">
		<Field label="First name" name="firstName" autocomplete="given-name" required placeholder="Jane" bind:value={firstName} />
		<Field
			label="Other names"
			name="otherNames"
			autocomplete="family-name"
			required
			placeholder="Mumbi Mwangi"
			bind:value={otherNames}
		/>
	</div>
	<Field
		label="Email"
		name="email"
		type="email"
		autocomplete="email"
		required
		readonly={!!lockedEmail}
		bind:value={email}
	/>
	<Field
		label="Password"
		name="password"
		type="password"
		autocomplete="new-password"
		required
		bind:value={password}
	/>
	{#if message}
		<p class="text-sm text-red-500">{message}</p>
	{/if}
	<Submit disabled={submitting}>Create account</Submit>
</form>
