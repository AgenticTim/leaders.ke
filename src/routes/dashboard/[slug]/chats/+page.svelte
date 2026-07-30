<script lang="ts">
	import { enhance } from '$app/forms';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

	let replyingTo = $state<number | null>(null);

	// Who each message is from, for the label + alignment. The AI and team share
	// the "us" side; only the citizen sits on the other.
	const senderLabel = (sender: string) => {
		if (sender === 'follower') return 'Citizen';
		if (sender === 'ai') return 'AI';
		return 'Team';
	};
</script>

<svelte:head><title>Chats — Dashboard</title></svelte:head>

<div class="max-w-3xl">
	<h1 class="text-xl font-bold text-heading">Chats</h1>
	<p class="mt-1 text-sm text-muted">
		Questions citizens asked from your campaign and record pages. Ones the AI answered are here for
		reference; ones it couldn't (no credit) are waiting for your reply.
	</p>

	{#if form?.error}
		<div
			class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading"
		>
			{form.error}
		</div>
	{/if}

	{#if data.threads.length > 0}
		<div class="mt-6 space-y-5">
			{#each data.threads as thread (thread.id)}
				<article class="rounded-2xl border border-border bg-surface p-5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-sm font-semibold text-heading">{thread.citizenName}</p>
						<div class="flex items-center gap-2">
							{#if thread.awaitingReply}
								<span
									class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary"
								>
									Awaiting reply
								</span>
							{/if}
							<span class="text-xs text-muted">{dateFmt.format(new Date(thread.lastActivity))}</span
							>
						</div>
					</div>

					<div class="mt-3 space-y-2">
						{#each thread.messages as message (message.id)}
							{@const mine = message.sender !== 'follower'}
							<div class="flex {mine ? 'justify-end' : 'justify-start'}">
								<div
									class="max-w-[85%] rounded-2xl px-3 py-2 text-sm {mine
										? 'bg-primary-soft text-on-primary'
										: 'bg-surface-2 text-heading'}"
								>
									<p class="text-xs font-semibold opacity-70">{senderLabel(message.sender)}</p>
									<p class="mt-0.5 leading-relaxed whitespace-pre-line">{message.body}</p>
								</div>
							</div>
						{/each}
					</div>

					{#if replyingTo === thread.id}
						<form
							method="post"
							action="?/reply"
							class="mt-4 space-y-2"
							use:enhance={() => {
								return async ({ update }) => {
									await update();
									replyingTo = null;
								};
							}}
						>
							<input type="hidden" name="conversationId" value={thread.id} />
							<textarea
								name="body"
								rows="2"
								required
								placeholder="Write your reply"
								class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
							></textarea>
							<div class="flex gap-2">
								<button
									type="submit"
									class="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:brightness-95"
								>
									Send reply
								</button>
								<button
									type="button"
									onclick={() => (replyingTo = null)}
									class="rounded-full px-4 py-1.5 text-sm font-medium text-muted transition hover:text-heading"
								>
									Cancel
								</button>
							</div>
						</form>
					{:else}
						<button
							type="button"
							onclick={() => (replyingTo = thread.id)}
							class="mt-4 rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-heading transition hover:bg-surface-2"
						>
							Reply
						</button>
					{/if}
				</article>
			{/each}
		</div>
		<Pagination
			page={data.page}
			{totalPages}
			total={data.total}
			itemLabel="chats"
			href={(p) => `?page=${p}`}
		/>
	{:else}
		<p class="mt-6 text-sm text-muted">No citizen questions yet.</p>
	{/if}
</div>
