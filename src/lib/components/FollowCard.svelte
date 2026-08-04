<script lang="ts">
	import { enhance } from '$app/forms';

	// One-click account-less candidate follow. A compact "Follow" button expands
	// into the same name + contact form the campaign page uses (markup mirrored
	// from Campaign.svelte); posts to /follow.
	let {
		candidateName,
		subjectUserId = null,
		candidateId = null,
		county = '',
		ward = '',
		compact = false
	}: {
		candidateName: string;
		subjectUserId?: number | null;
		candidateId?: string | null;
		county?: string;
		ward?: string;
		// Smaller trigger button, plain "Follow" instead of "Follow {firstName}",
		// for placing it side by side with another button (e.g. Pledge).
		compact?: boolean;
	} = $props();

	let open = $state(false);
	let following = $state(false);
	let followedAs = $state<string | null>(null);
	let followError = $state<string | null>(null);
</script>

{#if followedAs}
	<p class="rounded-xl bg-primary-soft px-3 py-2 text-xs font-medium text-on-primary">
		Karibu {followedAs}! You now follow {candidateName} and will get campaign updates.
	</p>
{:else if !open}
	<button
		type="button"
		onclick={() => (open = true)}
		aria-label={compact ? `Follow ${candidateName}` : undefined}
		class="rounded-full border border-primary font-semibold text-primary transition hover:bg-primary hover:text-on-primary {compact
			? 'px-3 py-1 text-xs'
			: 'w-full px-3 py-1.5 text-sm'}"
	>
		{compact ? 'Follow' : `Follow ${candidateName.split(/\s+/)[0]}`}
	</button>
{:else}
	<form
		method="post"
		action="/follow"
		class="w-48 space-y-2"
		use:enhance={() => {
			following = true;
			followError = null;
			return async ({ result }) => {
				following = false;
				if (result.type === 'success') {
					followedAs = String((result.data as { name?: string })?.name ?? '');
				} else if (result.type === 'failure') {
					followError = String((result.data as { error?: string })?.error ?? 'Could not follow.');
				}
			};
		}}
	>
		{#if subjectUserId}<input type="hidden" name="subjectUserId" value={subjectUserId} />{/if}
		{#if candidateId}<input type="hidden" name="candidateId" value={candidateId} />{/if}
		<input type="hidden" name="county" value={county} />
		<input type="hidden" name="ward" value={ward} />
		<input
			type="text"
			name="name"
			required
			placeholder="Your name"
			class="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:outline-none"
		/>
		<input
			type="text"
			name="contact"
			required
			placeholder="Phone or email"
			class="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:outline-none"
		/>
		{#if followError}
			<p class="text-xs font-medium text-heading">{followError}</p>
		{/if}
		<button
			type="submit"
			disabled={following}
			class="w-full rounded-full bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
		>
			{following ? 'Following…' : 'Follow'}
		</button>
		<p class="text-xs leading-relaxed text-muted">
			You opt in to campaign updates and can opt out anytime. We never share your political
			choices (Kenya Data Protection Act, 2019).
		</p>
	</form>
{/if}
