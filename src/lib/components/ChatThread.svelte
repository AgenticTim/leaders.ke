<script lang="ts">
	import { invalidate } from '$app/navigation';

	// The viewer's own persisted Ask history with one leader (questions, AI
	// answers, team replies) — rendered above the Ask form on the profile and
	// campaign pages from data.chatThread (chat.ts getWebThread), so the thread
	// survives refreshes and team replies actually reach the citizen.
	let {
		messages,
		awaitingReply,
		leaderFirstName,
		personId
	}: {
		messages: { id: number; sender: string; body: string; createdAt: string }[];
		awaitingReply: boolean;
		leaderFirstName: string;
		personId: number;
	} = $props();

	const senderLabel = (sender: string) =>
		sender === 'ai' ? 'AI' : sender === 'follower' ? 'You' : `${leaderFirstName}'s team`;

	// Live updates: an SSE ping fires when a message lands in this viewer's
	// thread (a team reply, typically) and the loader re-fetches — so replies
	// appear without a refresh. Connecting is gated on having history at all:
	// a first-time guest gains an identity (anon_id) with their first ask, and
	// hasHistory flipping true reconnects with the cookie now in place.
	const hasHistory = $derived(messages.length > 0);
	$effect(() => {
		if (!hasHistory) return;
		const source = new EventSource(`/api/chat/events?person=${personId}`);
		source.onmessage = () => invalidate('chat:thread');
		return () => source.close();
	});

	// Newest at the bottom, auto-scrolled into view like any chat.
	let scroller: HTMLDivElement | undefined = $state();
	$effect(() => {
		void messages.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

{#if messages.length > 0}
	<div bind:this={scroller} class="mt-3 max-h-72 space-y-2 overflow-y-auto">
		{#each messages as message (message.id)}
			<div class={message.sender === 'follower' ? 'flex justify-end' : 'flex justify-start'}>
				<div
					class="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line {message.sender ===
					'follower'
						? 'bg-primary-soft text-on-primary'
						: 'bg-surface-2 text-heading'}"
				>
					{#if message.sender !== 'follower'}
						<p class="text-[11px] font-semibold text-muted">{senderLabel(message.sender)}</p>
					{/if}
					{message.body}
				</div>
			</div>
		{/each}
		{#if awaitingReply}
			<p class="text-center text-xs text-muted">
				The team has your question and will get back to you here.
			</p>
		{/if}
	</div>
{/if}
