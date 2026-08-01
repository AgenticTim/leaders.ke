<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import ReviewFilter from '$lib/components/ReviewFilter.svelte';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import { filterAndSortReviews } from '$lib/reviewFilter';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const awaitingChats = $derived(data.threads.filter((t) => t.awaitingReply).length);

	// Live updates: the team-scoped SSE stream pings on every new message in
	// any of this leader's threads, and the loader re-fetches — so a citizen's
	// question (or an AI answer) lands in the list without a refresh.
	$effect(() => {
		const source = new EventSource(`/api/chat/events?person=${data.chatPersonId}&role=team`);
		source.onmessage = () => invalidate('chat:thread');
		return () => source.close();
	});

	const fmt = new Intl.NumberFormat('en-KE');
	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const dateTimeFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
	const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

	const reviewPages = $derived(Math.max(1, Math.ceil(data.reviewTotal / data.pageSize)));
	const chatPages = $derived(Math.max(1, Math.ceil(data.chatTotal / data.pageSize)));
	// Each column keeps its own page cursor; paging one preserves the other's page.
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

	// Chats state
	let replyingTo = $state<number | null>(null);
	const senderLabel = (sender: string) => {
		if (sender === 'follower') return 'Citizen';
		if (sender === 'ai') return 'AI';
		return 'Team';
	};
</script>

<svelte:head><title>Respond — Dashboard</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">Respond</h1>
	<p class="mt-1 text-sm text-muted">Answer citizens directly: reply to the questions they asked, and moderate and respond to reviews.</p>

	{#if form?.error}
		<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{form.error}</div>
	{/if}

	<div class="mt-6 grid gap-8 lg:grid-cols-2">
		<!-- Chats (left) -->
		<section>
			<h2 class="text-lg font-semibold text-heading">
				Chats <span class="text-sm font-normal text-muted">({data.chatTotal}{#if awaitingChats > 0} · {awaitingChats} awaiting{/if})</span>
			</h2>
			<p class="mt-1 text-sm text-muted">Questions from your campaign and record pages. Ones the AI couldn't answer (no credit) are waiting for your reply.</p>

			{#if data.threads.length > 0}
				<div class="mt-4 space-y-5">
					{#each data.threads as thread (thread.id)}
						<article class="rounded-2xl border border-border bg-surface p-5">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p class="text-sm font-semibold text-heading">{thread.citizenName}</p>
								<div class="flex items-center gap-2">
									{#if thread.awaitingReply}
										<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">Awaiting reply</span>
									{/if}
									<span class="text-xs text-muted">{dateTimeFmt.format(new Date(thread.lastActivity))}</span>
								</div>
							</div>

							<div class="mt-3 space-y-2">
								{#each thread.messages as message (message.id)}
									{@const mine = message.sender !== 'follower'}
									<div class="flex {mine ? 'justify-end' : 'justify-start'}">
										<div class="max-w-[85%] rounded-2xl px-3 py-2 text-sm {mine ? 'bg-primary-soft text-on-primary' : 'bg-surface-2 text-heading'}">
											<p class="text-xs font-semibold opacity-70">{senderLabel(message.sender)}</p>
											<p class="mt-0.5 leading-relaxed whitespace-pre-line">{message.body}</p>
										</div>
									</div>
								{/each}
							</div>

							{#if replyingTo === thread.id}
								<form method="post" action="?/reply" class="mt-4 space-y-2" use:enhance={() => async ({ update }) => { await update(); replyingTo = null; }}>
									<input type="hidden" name="conversationId" value={thread.id} />
									<textarea name="body" rows="2" required placeholder="Write your reply" class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"></textarea>
									<div class="flex gap-2">
										<button type="submit" class="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:brightness-95">Send reply</button>
										<button type="button" onclick={() => (replyingTo = null)} class="rounded-full px-4 py-1.5 text-sm font-medium text-muted transition hover:text-heading">Cancel</button>
									</div>
								</form>
							{:else}
								<button type="button" onclick={() => (replyingTo = thread.id)} class="mt-4 rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-heading transition hover:bg-surface-2">Reply</button>
							{/if}
						</article>
					{/each}
				</div>
				<Pagination page={data.chatsPage} totalPages={chatPages} total={data.chatTotal} itemLabel="chats" href={chatHref} />
			{:else}
				<p class="mt-6 text-sm text-muted">No citizen questions yet.</p>
			{/if}
		</section>

		<!-- Reviews (right) -->
		<section>
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
</div>
