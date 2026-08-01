<script lang="ts">
	// The viewer's own persisted Ask history with one leader (questions, AI
	// answers, team replies) — rendered above the Ask form on the profile and
	// campaign pages from data.chatThread (chat.ts getWebThread), so the thread
	// survives refreshes and team replies actually reach the citizen.
	let {
		messages,
		awaitingReply,
		leaderFirstName
	}: {
		messages: { id: number; sender: string; body: string; createdAt: string }[];
		awaitingReply: boolean;
		leaderFirstName: string;
	} = $props();

	const senderLabel = (sender: string) =>
		sender === 'ai' ? 'AI' : sender === 'follower' ? 'You' : `${leaderFirstName}'s team`;

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
