<script lang="ts" module>
	// Client-side mirror of LeaderHoverCardData ($lib/server/metrics), the
	// /api/leader-card response shape; declared here so this client component
	// never imports from $lib/server.
	type HoverCard = {
		path: string;
		name: string;
		initials: string;
		photoUrl: string | null;
		verified: boolean;
		party: string | null;
		partyPath: string | null;
		positionTitle: string;
		region: string;
		status: string;
		bio: string;
		campaignPositionTitle: string | null;
		campaignRegion: string | null;
		campaignStatus: string | null;
		tone: number[] | null;
	};

	// Session-wide cache: one fetch per slug across every hover instance on the
	// page. The promise (not the value) is cached so simultaneous hovers of the
	// same name share a single request.
	const cache = new Map<string, Promise<HoverCard | null>>();
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import LeaderCard from './LeaderCard.svelte';

	// Wraps a leader-name link: hovering (pointer devices only) pops the large
	// LeaderCard beneath it, fetched async from /api/leader-card. On touch the
	// wrapper is inert and a tap just follows the link inside.
	//
	// `align` picks which edge the (wide) card hangs from: 'left' suits a name in
	// running text, 'right' keeps it on screen when the trigger sits in a
	// right-hand column. `wrapperClass` overrides the wrapper's own display for
	// triggers that aren't inline (e.g. a full-width sidebar row).
	let {
		path,
		align = 'left',
		wrapperClass = 'inline-block',
		children
	}: { path: string; align?: 'left' | 'right'; wrapperClass?: string; children: Snippet } = $props();

	let open = $state(false);
	let card = $state<HoverCard | null>(null);
	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	function load(): Promise<HoverCard | null> {
		const slug = path.replace(/^\//, '');
		let pending = cache.get(slug);
		if (!pending) {
			pending = fetch(`/api/leader-card?slug=${encodeURIComponent(slug)}`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			cache.set(slug, pending);
		}
		return pending;
	}

	function enter() {
		if (!window.matchMedia('(hover: hover)').matches) return;
		clearTimeout(closeTimer);
		// Short intent delay so skimming the feed doesn't flash cards.
		openTimer = setTimeout(async () => {
			card = await load();
			if (card) open = true;
		}, 250);
	}
	function leave() {
		clearTimeout(openTimer);
		// Grace period lets the pointer cross the gap into the card itself.
		closeTimer = setTimeout(() => (open = false), 150);
	}
</script>

<span class="relative {wrapperClass}" role="presentation" onmouseenter={enter} onmouseleave={leave}>
	{@render children()}
	{#if open && card}
		<!-- Below the trigger, hanging from whichever edge `align` names. Sized to
		match a /compare grid column (~38rem on a max-w-7xl two-column grid) so the
		large card lays out identically there and here; the card's own stretched
		link makes it clickable. -->
		<div
			class="absolute top-full z-30 mt-1 w-[38rem] max-w-[85vw] rounded-2xl shadow-xl {align === 'right'
				? 'right-0'
				: 'left-0'}"
		>
			<LeaderCard
				large
				path={card.path}
				name={card.name}
				initials={card.initials}
				photoUrl={card.photoUrl}
				verified={card.verified}
				party={card.party}
				partyPath={card.partyPath}
				positionTitle={card.positionTitle}
				region={card.region}
				campaignPositionTitle={card.campaignPositionTitle}
				campaignRegion={card.campaignRegion}
				campaignStatus={card.campaignStatus}
				status={card.status}
				bio={card.bio}
				tone={card.tone}
			/>
		</div>
	{/if}
</span>
