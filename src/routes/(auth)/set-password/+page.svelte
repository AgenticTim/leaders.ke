<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import Field from '$lib/components/auth/Field.svelte';
	import Submit from '$lib/components/auth/Submit.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<AuthCard title="Set password" subtitle="Add a password so you can also log in without Google">
	{#if form?.success}
		<p class="rounded-lg bg-primary-soft px-4 py-3 text-sm text-on-primary">
			Your password has been set.
		</p>
	{:else}
		<form method="post" use:enhance class="space-y-4">
			<Field
				label="New password"
				name="newPassword"
				type="password"
				autocomplete="new-password"
				required
			/>
			{#if form?.message}
				<p class="text-sm text-red-500">{form.message}</p>
			{/if}
			<Submit>Set password</Submit>
		</form>
	{/if}

	{#snippet footer()}
		<a href="/" class="font-semibold text-primary hover:underline">Back to home</a>
	{/snippet}
</AuthCard>
