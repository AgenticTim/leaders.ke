<script lang="ts">
	// Platform-wide AI chat (plans/10-platform-wide-ai-chat.md): a sparkle button
	// in the header opens a slide-over panel that answers any civic or platform
	// question, grounded in vote.ke's own data via /api/platform-ask.
	//
	// Unlike the per-leader Ask block (a form action on that leader's page, with
	// its thread server-rendered into the page data), this lives in the shared
	// Header on every route, so it owns its own fetch/state and loads its thread
	// lazily the first time it's opened.
	import TypingDots from '$lib/components/TypingDots.svelte';
	import CloseIcon from '$lib/components/svgs/CloseIcon.svelte';
	import { portal } from '$lib/effects';
	import { formatChatTime } from '$lib/utils/chatTime';

	type Message = { id: number; sender: string; body: string; createdAt: string };

	let open = $state(false);
	let messages = $state<Message[]>([]);
	let question = $state('');
	let asking = $state(false);
	let errorText = $state<string | null>(null);
	// Guest allowance spent — pairs the message below with a log-in link, since
	// signing in is the actual remedy rather than retrying.
	let limitReached = $state(false);
	// Overwritten by the server's own askMaxChars on first load; this default
	// only governs the moment before that lands.
	let maxChars = $state(300);
	let loadedThread = false;
	let scroller: HTMLDivElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();

	// Starters (the plan's prompt-starter chips) — shown only on an empty thread,
	// where a blank box is hardest to start from.
	const STARTERS = [
		'Who is my MP?',
		'What does a Woman Rep actually do?',
		'How do I check if I am registered to vote?',
		'What does a campaign page cost?',
		'How many gen-z will vote in 2027?'
	];

	async function loadThread() {
		try {
			const res = await fetch('/api/platform-ask');
			if (!res.ok) return;
			const data = await res.json();
			messages = data.messages ?? [];
			// Admin-editable cap (platformSettings.askMaxChars) — the server
			// truncates to it regardless, this just stops the textarea accepting
			// more than will actually be used.
			if (typeof data.maxChars === 'number') maxChars = data.maxChars;
		} catch {
			// Offline or a transient failure — the panel still works for new asks.
		}
	}

	// The thread is fetched once per page-load session, on first open: most
	// visitors never open the panel, so loading it eagerly on every route would
	// tax every page view for a feature few use on any given visit.
	async function ensureThread() {
		if (loadedThread) return;
		loadedThread = true;
		await loadThread();
	}

	// Live delivery: once this visitor HAS a thread, subscribe to the platform
	// SSE stream so a vote.ke admin's reply from the platform inbox lands in the
	// open panel without a reload. Gated on having history because a visitor with
	// no anon_id cookie yet has no thread to stream (the endpoint 403s), and the
	// cookie only exists after their first ask — at which point hasThread flips
	// and this reconnects.
	const hasThread = $derived(messages.length > 0);
	$effect(() => {
		if (!open || !hasThread) return;
		const source = new EventSource('/api/chat/events?scope=platform');
		source.onmessage = () => loadThread();
		return () => source.close();
	});

	function toggle() {
		open = !open;
		if (open) {
			ensureThread();
			// Focus after the panel has actually rendered.
			setTimeout(() => input?.focus(), 50);
		}
	}

	async function ask() {
		const body = question.trim();
		if (body.length < 5 || asking) return;
		asking = true;
		errorText = null;
		limitReached = false;
		// Optimistic: the citizen's own question appears immediately, with a
		// negative temp id so it can't collide with a real messages.id.
		messages = [...messages, { id: -Date.now(), sender: 'follower', body, createdAt: new Date().toISOString() }];
		question = '';

		try {
			const res = await fetch('/api/platform-ask', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question: body })
			});
			const data = await res.json();
			if (!res.ok) {
				errorText = data.error ?? 'Something went wrong. Try again.';
			} else if (data.answered && data.answer) {
				messages = [...messages, { id: -Date.now() - 1, sender: 'ai', body: data.answer, createdAt: new Date().toISOString() }];
			} else if (data.reason === 'guest-limit') {
				// Nothing is broken here — the free guest allowance is simply spent,
				// so say that plainly and point at the way to get more answers.
				limitReached = true;
				errorText = "You have hit your daily limit for guests.";
			} else {
				// Recorded but genuinely unanswerable right now (no AI configured, or
				// the call failed): it's in the platform inbox for a human.
				errorText = 'AI unavailable at the moment. Someone will get back to you soon.';
			}
		} catch {
			errorText = 'Could not reach vote.ke. Check your connection and try again.';
		} finally {
			asking = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		// Enter sends, Shift+Enter newlines — standard chat behavior.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			ask();
		}
	}

	// Newest at the bottom, like any chat.
	$effect(() => {
		void messages.length;
		void asking;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) open = false;
	}}
/>

<button
	type="button"
	onclick={toggle}
	aria-label="Ask vote.ke"
	aria-expanded={open}
	class="grid size-9 place-items-center rounded-full border border-border bg-surface-2 text-heading transition hover:bg-surface-3 focus:ring-0 focus:ring-ring focus:outline-none"
>
	<!-- sparkle -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-4.5">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4 12 3.5Z"
		/>
		<path stroke-linecap="round" stroke-linejoin="round" d="M18 16l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7L18 16Z" />
	</svg>
</button>

{#if open}
	<!-- Anchored bottom-right like a help chat, not a modal: no dimming backdrop
	and no aria-modal, so the page behind stays readable and usable while the
	panel is open (a citizen asking "who is my MP" is often mid-page on a profile
	or seat listing they want to keep looking at). Closes on Escape or the X.
	use:portal is required, not cosmetic: this component is mounted inside the
	sticky header, whose backdrop-blur would otherwise make IT the containing
	block for this fixed panel, anchoring it to the header instead of the screen. -->
	<div
		use:portal
		role="dialog"
		aria-label="Ask vote.ke"
		class="fixed right-4 bottom-4 z-50 flex max-h-[min(32rem,70vh)] w-[calc(100vw-2rem)] flex-col rounded-3xl border border-border bg-surface shadow-2xl sm:w-104"
	>
		<div class="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
			<div>
				<p class="font-semibold text-heading">Ask vote.ke</p>
				<p class="mt-0.5 text-xs text-muted">Candidates, seats, elections, and how this platform works.</p>
			</div>
			<button
				type="button"
				onclick={() => (open = false)}
				aria-label="Close"
				class="shrink-0 rounded-full p-1 text-muted transition hover:bg-surface-2 hover:text-heading"
			>
				<CloseIcon class="size-4" />
			</button>
		</div>

		<div bind:this={scroller} class="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
			{#if messages.length === 0}
				<p class="text-sm text-muted">Ask anything about Kenyan elections, your leaders, or vote.ke.</p>
				<div class="flex flex-wrap gap-1.5 pt-1">
					{#each STARTERS as starter (starter)}
						<button
							type="button"
							onclick={() => {
								question = starter;
								input?.focus();
							}}
							class="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition hover:border-primary hover:text-primary"
						>
							{starter}
						</button>
					{/each}
				</div>
			{/if}

			{#each messages as message (message.id)}
				<div class={message.sender === 'follower' ? 'flex justify-end' : 'flex justify-start'}>
					<div
						class="max-w-[85%] min-w-32 rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line {message.sender ===
						'follower'
							? 'bg-primary-soft text-on-primary'
							: 'bg-surface-2 text-heading'}"
					>
						<p class="flex items-baseline justify-between gap-3 text-[11px]">
							<span class="font-semibold opacity-70">{message.sender === 'follower' ? 'You' : 'vote.ke'}</span>
							<span class="opacity-60">{formatChatTime(message.createdAt)}</span>
						</p>
						{message.body}
					</div>
				</div>
			{/each}

			{#if asking}
				<div class="flex justify-start">
					<div class="rounded-2xl bg-surface-2 px-3.5 py-2 text-sm text-muted">Thinking<TypingDots /></div>
				</div>
			{/if}

			{#if errorText}
				<p class="rounded-xl bg-surface-2 px-3.5 py-2 text-xs text-muted">
					{errorText}
					{#if limitReached}
						<a href="/login" class="font-semibold text-primary hover:underline">Log in to keep asking.</a>
					{/if}
				</p>
			{/if}
		</div>

		<div class="border-t border-border p-3">
			<div class="flex items-end gap-2">
				<textarea
					bind:this={input}
					bind:value={question}
					onkeydown={onKeydown}
					rows="1"
					maxlength={maxChars}
					placeholder="Ask a question…"
					aria-label="Your question"
					class="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
				></textarea>
				<button
					type="button"
					onclick={ask}
					disabled={asking || question.trim().length < 5}
					class="shrink-0 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-50"
				>
					Ask
				</button>
			</div>
			<p class="mt-1.5 flex items-baseline justify-between gap-3 text-[11px] text-muted">
				<span>AI answers can be wrong. Check anything that matters against the official source.</span>
				<!-- Only once it's close to mattering, so the counter isn't noise on a
				short question. -->
				{#if question.length > maxChars * 0.75}
					<span class="shrink-0 tabular-nums">{question.length}/{maxChars}</span>
				{/if}
			</p>
		</div>
	</div>
{/if}
