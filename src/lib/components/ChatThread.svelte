<script lang="ts">
	import { invalidate } from '$app/navigation';
	import TypingDots from '$lib/components/TypingDots.svelte';
	import { formatChatTime } from '$lib/utils/chatTime';

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
	// The same stream carries transient `typing` events from the team side.
	const hasHistory = $derived(messages.length > 0);
	let teamTyping = $state(false);
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!hasHistory) return;
		const source = new EventSource(`/api/chat/events?person=${personId}`);
		source.onmessage = () => {
			teamTyping = false; // the reply the typing announced has landed
			invalidate('chat:thread');
		};
		source.addEventListener('typing', () => {
			teamTyping = true;
			clearTimeout(typingTimer);
			typingTimer = setTimeout(() => (teamTyping = false), 4000);
		});
		return () => {
			source.close();
			clearTimeout(typingTimer);
		};
	});

	// Newest at the bottom, auto-scrolled into view like any chat.
	let scroller: HTMLDivElement | undefined = $state();
	$effect(() => {
		void messages.length;
		void teamTyping;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<script lang="ts" module>
	/** Throttled "I'm typing" signal for the Ask textarea (oninput) — at most
	 * one POST every 2s; the team's Respond tab shows the indicator. */
	let lastTypingSentAt = 0;
	export function signalTyping(personId: number, conversationId?: number) {
		const now = Date.now();
		if (now - lastTypingSentAt < 2000) return;
		lastTypingSentAt = now;
		void fetch('/api/chat/typing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(conversationId ? { person: personId, conversationId } : { person: personId })
		});
	}
</script>

{#if messages.length > 0}
	<div bind:this={scroller} class="mt-3 max-h-72 space-y-2 overflow-y-auto">
		{#each messages as message (message.id)}
			<div class={message.sender === 'follower' ? 'flex justify-end' : 'flex justify-start'}>
				<div
					class="max-w-[85%] min-w-32 rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line {message.sender ===
					'follower'
						? 'bg-primary-soft text-on-primary'
						: 'bg-surface-2 text-heading'}"
				>
					<p class="flex items-baseline justify-between gap-3 text-[11px]">
						<span class="font-semibold opacity-70">{senderLabel(message.sender)}</span>
						<span class="opacity-60">{formatChatTime(message.createdAt)}</span>
					</p>
					{message.body}
				</div>
			</div>
		{/each}
		{#if teamTyping}
			<div class="flex justify-start">
				<div class="rounded-2xl bg-surface-2 px-3.5 py-2 text-sm text-muted">
					{leaderFirstName}'s team is typing<TypingDots />
				</div>
			</div>
		{:else if awaitingReply}
			<p class="text-center text-xs text-muted">
				The team has your question and will get back to you here.
			</p>
		{/if}
	</div>
{/if}
