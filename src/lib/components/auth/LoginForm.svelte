<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import Field from './Field.svelte';
	import GoogleButton from './GoogleButton.svelte';
	import Submit from './Submit.svelte';

	// The login form body, shared by the /login page and AuthModal (embedded on any
	// page as a transitional step before follow/save-vote/etc). Every action posts
	// to absolute /login paths, never the host page's own query string — errors are
	// captured locally instead of read off the page's form prop, so the component
	// behaves identically wherever it's mounted.
	let {
		next = '/dashboard',
		googleEnabled = false,
		lockedEmail = null,
		initialEmail = '',
		initialPassword = ''
	}: {
		next?: string;
		googleEnabled?: boolean;
		lockedEmail?: string | null;
		initialEmail?: string;
		initialPassword?: string;
	} = $props();

	let message = $state<string | null>(null);
	let submitting = $state(false);
</script>

{#if googleEnabled}
	<GoogleButton label="Sign in with Google" {next} action="/login?/google" />
	<div class="my-5 flex items-center gap-3 text-xs text-muted">
		<span class="h-px flex-1 bg-border"></span>
		or
		<span class="h-px flex-1 bg-border"></span>
	</div>
{/if}

<form
	method="post"
	action="/login?/email"
	class="space-y-4"
	use:enhance={() => {
		submitting = true;
		message = null;
		return async ({ result }) => {
			submitting = false;
			if (result.type === 'failure') message = String((result.data as { message?: string })?.message ?? 'Sign in failed');
			else await applyAction(result);
		};
	}}
>
	<input type="hidden" name="next" value={next} />
	{#if lockedEmail}<input type="hidden" name="lockedEmail" value={lockedEmail} />{/if}
	<Field
		label="Email"
		name="email"
		type="email"
		autocomplete="email"
		required
		readonly={!!lockedEmail}
		value={initialEmail}
	/>
	<Field
		label="Password"
		name="password"
		type="password"
		autocomplete="current-password"
		required
		value={initialPassword}
	/>
	<div class="text-right">
		<a href="/forgot-password" class="text-sm font-medium text-primary hover:underline">
			Forgot password?
		</a>
	</div>
	{#if message}
		<p class="text-sm text-red-500">{message}</p>
	{/if}
	<Submit disabled={submitting}>Sign in</Submit>
</form>
