<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import ReviewFilter from '$lib/components/ReviewFilter.svelte';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import { filterAndSortReviews } from '$lib/reviewFilter';
	import TypingDots from '$lib/components/TypingDots.svelte';
	import { formatChatTime } from '$lib/utils/chatTime';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const awaitingChats = $derived(data.threads.filter((t) => t.awaitingReply).length);

	// Two-pane chats: the list on the left, the OPEN thread on the right.
	// Below lg the panes swap instead of sitting side by side (list, then the
	// opened thread with a back button). Desktop opens the first thread by
	// default; mobile starts on the list.
	let selectedId = $state<number | null>(null);
	$effect(() => {
		if (selectedId === null && data.threads.length > 0 && window.matchMedia('(min-width: 1024px)').matches) {
			selectedId = data.threads[0].id;
		}
	});
	const selectedThread = $derived(data.threads.find((t) => t.id === selectedId) ?? null);

	// Live updates: the team-scoped SSE stream pings on every new message in
	// any of this leader's threads, and the loader re-fetches — so a citizen's
	// question (or an AI answer) lands in the list without a refresh. The same
	// stream carries transient `typing` events (data = conversation id) when a
	// citizen is typing in a thread's Ask box.
	let typingThreads = $state<Record<number, boolean>>({});
	const typingTimers: Record<number, ReturnType<typeof setTimeout>> = {};
	$effect(() => {
		const source = new EventSource(`/api/chat/events?person=${data.chatPersonId}&role=team`);
		source.onmessage = (e) => {
			// The message this typing announced has landed — stop the indicator now
			// rather than waiting out its 4s decay.
			const threadId = Number(e.data);
			typingThreads[threadId] = false;
			clearTimeout(typingTimers[threadId]);
			invalidate('chat:thread');
		};
		source.addEventListener('typing', (e) => {
			const threadId = Number(e.data);
			typingThreads[threadId] = true;
			clearTimeout(typingTimers[threadId]);
			typingTimers[threadId] = setTimeout(() => (typingThreads[threadId] = false), 4000);
		});
		return () => {
			source.close();
			Object.values(typingTimers).forEach(clearTimeout);
		};
	});

	// Throttled "team is typing" signal from the reply box, mirrored on the
	// citizen's own page.
	let lastTypingSentAt = 0;
	function signalTeamTyping(conversationId: number) {
		const now = Date.now();
		if (now - lastTypingSentAt < 2000) return;
		lastTypingSentAt = now;
		void fetch('/api/chat/typing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ person: data.chatPersonId, conversationId })
		});
	}

	// The open thread scrolls to its newest message, like any chat.
	let scroller: HTMLDivElement | undefined = $state();
	$effect(() => {
		void selectedThread?.messages.length;
		void typingThreads[selectedId ?? 0];
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	const fmt = new Intl.NumberFormat('en-KE');
	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

	const reviewPages = $derived(Math.max(1, Math.ceil(data.reviewTotal / data.pageSize)));
	const chatPages = $derived(Math.max(1, Math.ceil(data.chatTotal / data.pageSize)));
	// Each section keeps its own page cursor; paging one preserves the other's page.
	const reviewHref = (p: number) => `?reviewsPage=${p}&chatsPage=${data.chatsPage}`;
	const chatHref = (p: number) => `?reviewsPage=${data.reviewsPage}&chatsPage=${p}`;

	// Reviews state
	let respondingTo = $state<number | null>(null);
	let flaggingId = $state<number | null>(null);
	const flagLabels: Record<string, string> = {
		spam: 'Spam',
		insult: 'Insult',
		incitement: 'Incitement',
		hate_speech: 'Hate speech',
		misinformation: 'Misinformation',
		other: 'Other'
	};
	let filterRating = $state<number | ''>('');
	let filterPillarTitle = $state('');
	let sortBy = $state<'recent' | 'likes'>('recent');
	let sortDir = $state<'asc' | 'desc'>('desc');
	const filteredReviews = $derived(
		filterAndSortReviews(data.reviews, { rating: filterRating, pillarTitle: filterPillarTitle, sortBy, sortDir })
	);

	const senderLabel = (sender: string) => {
		if (sender === 'follower') return 'Citizen';
		if (sender === 'ai') return 'AI';
		return 'Team';
	};

	/** One-line list preview: who spoke last + the first 30 chars of what they said. */
	const preview = (thread: (typeof data.threads)[number]) => {
		const last = thread.messages[thread.messages.length - 1];
		if (!last) return '';
		const snippet = last.body.length > 30 ? `${last.body.slice(0, 30)}…` : last.body;
		return `${last.sender === 'follower' ? '' : 'You: '}${snippet}`;
	};
</script>

<svelte:head><title>Inbox — Dashboard</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">Inbox</h1>
	<p class="mt-1 text-sm text-muted">Answer citizens directly: reply to the questions they asked, and moderate and respond to reviews.</p>

	{#if form?.error}
		<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{form.error}</div>
	{/if}

	<!-- Chats: list on the left, the open thread on the right -->
	<section class="mt-6">
		<h2 class="text-lg font-semibold text-heading">
			Chats <span class="text-sm font-normal text-muted">({data.chatTotal}{#if awaitingChats > 0} · {awaitingChats} awaiting{/if})</span>
		</h2>
		<p class="mt-1 text-sm text-muted">Questions from your campaign and record pages. Ones the AI couldn't answer (no credit) are waiting for your reply.</p>

		{#if data.threads.length > 0}
			<div class="mt-4 grid gap-4 lg:grid-cols-[2fr_3fr]">
				<!-- Chat list -->
				<div class={selectedId !== null ? 'hidden lg:block' : ''}>
					<div class="overflow-hidden rounded-2xl border border-border bg-surface">
						{#each data.threads as thread (thread.id)}
							<button
								type="button"
								onclick={() => (selectedId = thread.id)}
								class="flex w-full items-start justify-between gap-3 border-b border-border px-4 py-3 text-left transition last:border-b-0 {selectedId === thread.id ? 'bg-primary-soft' : 'hover:bg-surface-2'}"
							>
								<span class="min-w-0">
									<span class="block text-sm font-semibold text-heading">{thread.citizenName}</span>
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
										<span class="size-2 rounded-full bg-primary" title="Awaiting reply"></span>
									{/if}
								</span>
							</button>
						{/each}
					</div>
					<Pagination page={data.chatsPage} totalPages={chatPages} total={data.chatTotal} itemLabel="chats" href={chatHref} />
				</div>

				<!-- Open thread -->
				<div class={selectedId === null ? 'hidden lg:block' : ''}>
					{#if selectedThread}
						<article class="flex h-full max-h-128 flex-col rounded-2xl border border-border bg-surface">
							<div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
								<div class="flex items-center gap-2">
									<button type="button" onclick={() => (selectedId = null)} class="rounded-full px-2 py-1 text-sm text-muted transition hover:text-heading lg:hidden" aria-label="Back to all chats">←</button>
									<p class="text-sm font-semibold text-heading">{selectedThread.citizenName}</p>
								</div>
								{#if selectedThread.awaitingReply}
									<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">Awaiting reply</span>
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
							<form method="post" action="?/reply" class="border-t border-border p-3" use:enhance>
								<input type="hidden" name="conversationId" value={selectedThread.id} />
								<div class="flex items-end gap-2">
									<textarea
										name="body"
										rows="1"
										required
										placeholder="Write your reply"
										oninput={() => selectedThread && signalTeamTyping(selectedThread.id)}
										onkeydown={(e) => {
											if (e.key === 'Enter' && !e.shiftKey) {
												e.preventDefault();
												e.currentTarget.form?.requestSubmit();
											}
										}}
										class="min-h-10 w-full flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
									></textarea>
									<button type="submit" class="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Send</button>
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
			<p class="mt-6 text-sm text-muted">No citizen questions yet.</p>
		{/if}
	</section>

	<!-- Reviews below the chats -->
	<section class="mt-10">
		<h2 class="text-lg font-semibold text-heading">
			Reviews <span class="text-sm font-normal text-muted">({data.reviewTotal})</span>
		</h2>
		<p class="mt-1 text-sm text-muted">Public by default. Flag one to hide it from public view (reversible), and respond directly.</p>

		{#if data.reviews.length > 0}
			<div class="mt-4">
				<ReviewFilter pillarOptions={data.pillarOptions} bind:rating={filterRating} bind:pillarTitle={filterPillarTitle} bind:sortBy bind:sortDir />
			</div>
			<div class="mt-4 space-y-5">
				{#each filteredReviews as review (review.id)}
					<article class="rounded-2xl border border-border bg-surface p-5">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<span class="text-sm tracking-widest text-primary" aria-label="{review.rating} out of 5 stars">{stars(review.rating)}</span>
								<p class="mt-1 text-xs font-semibold text-heading">
									{review.reviewerName}
									{#if !review.public}<span class="font-normal text-muted"> (Private)</span>{/if}
									{#if review.pillarTitle}<span class="font-normal text-muted"> · on {review.pillarTitle}</span>{/if}
									{#if review.likes > 0}<span class="font-normal text-muted"> · {fmt.format(review.likes)} like{review.likes === 1 ? '' : 's'}</span>{/if}
								</p>
							</div>
							<div class="flex items-center gap-2">
								<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold {review.flagReason ? 'bg-surface-2 text-muted' : 'bg-primary-soft text-on-primary'}">
									{review.flagReason ? `Flagged: ${flagLabels[review.flagReason]}` : 'Public'}
								</span>
								<span class="text-xs text-muted">{dateFmt.format(new Date(review.createdAt))}</span>
							</div>
						</div>

						<p class="mt-3 text-sm leading-relaxed whitespace-pre-line">{review.message}</p>

						<div class="mt-4 flex flex-wrap items-center gap-2">
							{#if review.flagReason}
								<form method="post" action="?/unflag" use:enhance>
									<input type="hidden" name="reviewId" value={review.id} />
									<button type="submit" class="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:brightness-95">Unflag</button>
								</form>
							{:else if flaggingId === review.id}
								<form method="post" action="?/flag" class="flex items-center gap-2" use:enhance={() => async ({ update }) => { await update(); flaggingId = null; }}>
									<input type="hidden" name="reviewId" value={review.id} />
									<select name="reason" required class="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none">
										<option value="" disabled selected>Reason</option>
										{#each data.flagReasons as reason (reason)}<option value={reason}>{flagLabels[reason]}</option>{/each}
									</select>
									<button type="submit" class="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-heading transition hover:bg-surface-2">Confirm flag</button>
									<button type="button" onclick={() => (flaggingId = null)} class="text-sm font-medium text-muted transition hover:text-heading">Cancel</button>
								</form>
							{:else}
								<button type="button" onclick={() => (flaggingId = review.id)} class="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-heading transition hover:bg-surface-2">Flag</button>
							{/if}
							{#if respondingTo !== review.id}
								<button type="button" onclick={() => (respondingTo = review.id)} class="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-heading transition hover:bg-surface-2">
									{review.response ? 'Edit response' : 'Respond'}
								</button>
							{/if}
						</div>

						{#if review.response && respondingTo !== review.id}
							<div class="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
								<p class="text-xs font-semibold text-muted">Your response</p>
								<p class="mt-1 whitespace-pre-line">{review.response.body}</p>
							</div>
						{/if}

						{#if respondingTo === review.id}
							<form method="post" action="?/respond" class="mt-3 space-y-2" use:enhance={() => async ({ update }) => { await update(); respondingTo = null; }}>
								<input type="hidden" name="reviewId" value={review.id} />
								<textarea name="body" rows="2" required placeholder="Write your response" value={review.response?.body ?? ''} class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"></textarea>
								<div class="flex gap-2">
									<button type="submit" class="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:brightness-95">Post response</button>
									<button type="button" onclick={() => (respondingTo = null)} class="rounded-full px-4 py-1.5 text-sm font-medium text-muted transition hover:text-heading">Cancel</button>
								</div>
							</form>
						{/if}
					</article>
				{:else}
					<p class="text-sm text-muted">No reviews match those filters.</p>
				{/each}
			</div>
			<Pagination page={data.reviewsPage} totalPages={reviewPages} total={data.reviewTotal} itemLabel="reviews" href={reviewHref} />
		{:else}
			<p class="mt-6 text-sm text-muted">No public reviews yet.</p>
		{/if}
	</section>
</div>
