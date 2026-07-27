<script lang="ts">
	// The header's round bell button — same round-button idiom as ThemeToggle. It's
	// a pure count + deep link now: the full history (and any open invites) lives
	// on the /dashboard/notifications tab, not a dropdown, so the badge just tells
	// you there's something worth opening that tab for.
	let unreadCount = $state(0);

	async function load() {
		try {
			const res = await fetch('/api/notifications');
			if (!res.ok) return;
			const data = await res.json();
			unreadCount = data.unreadCount;
		} catch {
			// Best-effort — the tab itself is still reachable either way.
		}
	}

	$effect(() => {
		load();
	});
</script>

<a
	href="/dashboard/notifications"
	aria-label="Notifications"
	class="relative flex size-9 items-center justify-center rounded-full border border-border bg-surface text-heading transition hover:bg-surface-2"
>
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-4.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
	</svg>
	{#if unreadCount > 0}
		<span class="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-on-primary">
			{unreadCount > 9 ? '9+' : unreadCount}
		</span>
	{/if}
</a>
