<script lang="ts">
	// The two-pane chat inbox shared by BOTH the campaign Inbox tab and the admin
	// platform inbox: thread list on the left, open thread + composer on the
	// right, swapping to one pane below lg. Everything visual lives here, so a
	// change to bubbles, list rows or the composer lands on both inboxes at once.
	//
	// The two differ only in wiring, which is what the props cover: which SSE
	// stream to listen on, whether citizen-typing signals exist to receive/send,
	// what to call the non-AI human replying, and how paging URLs are built.
	import { tooltip } from '$lib/effects';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import TypingDots from '$lib/components/TypingDots.svelte';
	import { formatChatTime } from '$lib/utils/chatTime';

	// Structurally typed rather than importing from $lib/server/chat — a client
	// component can't import a server module, type-only or otherwise.
	type Message = { id: number; sender: string; body: string; createdAt: string };
	type Thread = {
		id: number;
		citizenName: string;
		awaitingReply: boolean;
		lastActivity: string;
		messages: Message[];
		anonId?: string | null;
		ipAddress?: string | null;
	};

	let {
		threads,
		page,
		totalPages,
		total,
		pageHref,
		eventsUrl,
		teamLabel = 'Team',
		itemLabel = 'chats',
		emptyText = 'No citizen questions yet.',
		onTyping,
		onReplied
	}: {
		threads: Thread[];
		page: number;
		totalPages: number;
		total: number;
		pageHref: (p: number) => string;
		/** SSE stream for this inbox's own scope (a leader's threads, or platform). */
		eventsUrl: string;
		/** What a non-AI, non-citizen reply is labelled — a campaign's team vs the platform's. */
		teamLabel?: string;
		itemLabel?: string;
		emptyText?: string;
		/** Sends the "team is typing" ping, where the citizen side can receive it.
		 * Omitted for the platform inbox: the header Ask panel doesn't listen for
		 * typing, so signalling it there would be a no-op. */
		onTyping?: (conversationId: number) => void;
		/** Lets the host page react to a reply (e.g. toast whether the asker was
		 * reachable), since that differs per inbox. */
		onReplied?: (result: { type: string; data?: Record<string, unknown> }) => void;
	} = $props();

	// Unanswered first, then newest activity — both inboxes are worked as a
	// queue, so what needs a human belongs at the top.
	const ordered = $derived(
		[...threads].sort((a, b) => Number(b.awaitingReply) - Number(a.awaitingReply) || b.lastActivity.localeCompare(a.lastActivity))
	);

	// Desktop opens the first thread by default; mobile starts on the list.
	let selectedId = $state<number | null>(null);
	$effect(() => {
		if (selectedId === null && ordered.length > 0 && window.matchMedia('(min-width: 1024px)').matches) {
			selectedId = ordered[0].id;
		}
	});
	const selectedThread = $derived(ordered.find((t) => t.id === selectedId) ?? null);

	// Live updates: a ping on any new message in this inbox's scope re-runs the
	// loader, so a citizen's question appears without a refresh. The same stream
	// carries transient `typing` events (data = conversation id).
	let typingThreads = $state<Record<number, boolean>>({});
	const typingTimers: Record<number, ReturnType<typeof setTimeout>> = {};
	$effect(() => {
		const source = new EventSource(eventsUrl);
		source.onmessage = (e) => {
			// The message the typing announced has landed — clear it now rather
			// than waiting out the 4s decay.
			const threadId = Number(e.data);
			typingThreads[threadId] = false;
			clearTimeout(typingTimers[threadId]);
			invalidate('chat:thread');
		};
		source.addEventListener('typing', (e) => {
			const threadId = Number((e as MessageEvent).data);
			typingThreads[threadId] = true;
			clearTimeout(typingTimers[threadId]);
			typingTimers[threadId] = setTimeout(() => (typingThreads[threadId] = false), 4000);
		});
		return () => {
			source.close();
			Object.values(typingTimers).forEach(clearTimeout);
		};
	});

	// The open thread scrolls to its newest message, like any chat.
	let scroller: HTMLDivElement | undefined = $state();
	$effect(() => {
		void selectedThread?.messages.length;
		void typingThreads[selectedId ?? 0];
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	const senderLabel = (sender: string) => (sender === 'follower' ? 'Citizen' : sender === 'ai' ? 'AI' : teamLabel);

	/** One-line list preview: who spoke last + the first 30 chars of what they said. */
	const preview = (thread: Thread) => {
		const last = thread.messages[thread.messages.length - 1];
		if (!last) return '';
		const snippet = last.body.length > 30 ? `${last.body.slice(0, 30)}…` : last.body;
		return `${last.sender === 'follower' ? '' : 'You: '}${snippet}`;
	};
</script>

{#snippet identity(thread: Thread)}
	{thread.citizenName}
	<!-- A guest thread carries no name, so the address/device id is the only way
	to tell two anonymous askers apart (and to spot one abusing the box). Absent
	on signed-in threads, where the account name already identifies it. -->
	{#if thread.ipAddress}<span class="font-normal text-muted">{thread.ipAddress}</span>{/if}
	{#if thread.anonId}<span class="font-mono text-xs font-normal text-muted">{thread.anonId}</span>{/if}
{/snippet}

{#if ordered.length > 0}
	<div class="mt-4 grid gap-4 lg:grid-cols-[2fr_5fr]">
		<!-- Thread list -->
		<div class={selectedId !== null ? 'hidden lg:block' : ''}>
			<div class="overflow-hidden rounded-2xl border border-border bg-surface">
				{#each ordered as thread (thread.id)}
					<button
						type="button"
						onclick={() => (selectedId = thread.id)}
						class="flex w-full items-start justify-between gap-3 border-b border-border px-4 py-3 text-left transition last:border-b-0 {selectedId ===
						thread.id
							? 'bg-primary-soft'
							: 'hover:bg-surface-2'}"
					>
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold text-heading">{@render identity(thread)}</span>
							<span class="mt-0.5 block truncate text-xs text-muted">
								{#if typingThreads[thread.id]}
									typing<TypingDots />
								{:else}
									{preview(thread)}
								{/if}
							</span>
						</span>
						<span class="flex shrink-0 flex-col items-end gap-1">
							<span class="text-xs text-muted">{formatChatTime(thread.lastActivity)}</span>
							{#if thread.awaitingReply}
								<span class="size-2 rounded-full bg-primary" use:tooltip={'Awaiting reply'}></span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
			<Pagination {page} {totalPages} {total} {itemLabel} href={pageHref} />
		</div>

		<!-- Open thread -->
		<div class={selectedId === null ? 'hidden lg:block' : ''}>
			{#if selectedThread}
				<article class="flex h-full max-h-128 flex-col rounded-2xl border border-border bg-surface">
					<div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
						<div class="flex min-w-0 items-center gap-2">
							<button
								type="button"
								onclick={() => (selectedId = null)}
								class="rounded-full px-2 py-1 text-sm text-muted transition hover:text-heading lg:hidden"
								aria-label="Back to all chats"
							>
								←
							</button>
							<p class="min-w-0 truncate text-sm font-semibold text-heading">{@render identity(selectedThread)}</p>
						</div>
						{#if selectedThread.awaitingReply}
							<span class="shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">Awaiting reply</span>
						{/if}
					</div>

					<div bind:this={scroller} class="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
						{#each selectedThread.messages as message (message.id)}
							{@const mine = message.sender !== 'follower'}
							<div class="flex {mine ? 'justify-end' : 'justify-start'}">
								<div class="max-w-[85%] min-w-32 rounded-2xl px-3 py-2 text-sm {mine ? 'bg-primary-soft text-on-primary' : 'bg-surface-2 text-heading'}">
									<p class="flex items-baseline justify-between gap-3 text-xs">
										<span class="font-semibold opacity-70">{senderLabel(message.sender)}</span>
										<span class="opacity-60">{formatChatTime(message.createdAt)}</span>
									</p>
									<p class="mt-0.5 leading-relaxed whitespace-pre-line">{message.body}</p>
								</div>
							</div>
						{/each}
						{#if typingThreads[selectedThread.id]}
							<div class="flex justify-start">
								<div class="rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted">
									{selectedThread.citizenName} is typing<TypingDots />
								</div>
							</div>
						{/if}
					</div>

					<!-- Composer: always open at the bottom of the thread -->
					<form
						method="post"
						action="?/reply"
						class="border-t border-border p-3"
						use:enhance={() => {
							return async ({ result, update }) => {
								onReplied?.(result);
								await update();
							};
						}}
					>
						<input type="hidden" name="conversationId" value={selectedThread.id} />
						<div class="flex items-end gap-2">
							<textarea
								name="body"
								rows="1"
								required
								placeholder="Write your reply"
								oninput={() => selectedThread && onTyping?.(selectedThread.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										e.currentTarget.form?.requestSubmit();
									}
								}}
								class="min-h-10 w-full flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
							></textarea>
							<button type="submit" class="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">
								Send
							</button>
						</div>
					</form>
				</article>
			{:else}
				<div class="hidden h-full min-h-48 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted lg:flex">
					Select a chat to read and reply.
				</div>
			{/if}
		</div>
	</div>
{:else}
	<p class="mt-6 text-sm text-muted">{emptyText}</p>
{/if}
