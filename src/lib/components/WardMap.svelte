<script lang="ts">
	import { tooltip } from '$lib/effects';

	// Choropleth for the Dominate voter heatmap: colors the seat's own wards
	// (or, for a national seat, every county) by pledge rate against that
	// area's 2022 register. Shapes come from src/lib/data/wardMaps/<key>.json
	// (built by scripts/build-ward-maps.ts from the same boundary polygons
	// locateSeat.ts uses), lazy-loaded per key so a visitor only ever
	// downloads the one map they're looking at.
	let {
		mapKey,
		rows,
		selectedSlug = null,
		onSelect
	}: {
		/** County slug (ward-level map) or 'national' (county-outline map). */
		mapKey: string;
		rows: { slug: string; pledges: number; registeredVoters: number }[];
		selectedSlug?: string | null;
		onSelect?: (slug: string) => void;
	} = $props();

	const mapLoaders = import.meta.glob('/src/lib/data/wardMaps/*.json', { import: 'default' }) as Record<
		string,
		() => Promise<{ viewBox: string; wards?: { slug: string; d: string }[]; counties?: { slug: string; d: string }[] }>
	>;

	let map = $state<{ viewBox: string; shapes: { slug: string; d: string }[] } | null>(null);
	$effect(() => {
		let cancelled = false;
		map = null;
		const load = mapLoaders[`/src/lib/data/wardMaps/${mapKey}.json`];
		if (!load) return;
		load().then((data) => {
			if (cancelled) return;
			map = { viewBox: data.viewBox, shapes: data.wards ?? data.counties ?? [] };
		});
		return () => {
			cancelled = true;
		};
	});

	const byRate = $derived(new Map(rows.map((r) => [r.slug, r.registeredVoters ? r.pledges / r.registeredVoters : 0])));
	const byPledges = $derived(new Map(rows.map((r) => [r.slug, r.pledges])));
	const byVoters = $derived(new Map(rows.map((r) => [r.slug, r.registeredVoters])));

	// Sequential scale, one hue (the brand primary), light→dark steps — never a
	// rainbow. Areas with pledges are bucketed into quartiles of the rates
	// actually present (so the scale reflects THIS seat's spread, not a fixed
	// global one); zero-pledge areas get a flat neutral "no data" fill, kept
	// visually distinct from "lowest non-zero bucket" rather than starting the
	// ramp at invisible. Mixed against the theme's own surface, so both light
	// and dark mode stay correct automatically.
	const STEPS = ['30%', '53%', '77%', '100%'];
	// Quartile boundaries (p25/p50/p75) split the non-zero rates into 4 bins;
	// the max rate always falls in the last bin since nothing exceeds p75 by
	// definition — a fixed max-as-boundary would instead trap the top area in
	// the second-to-last step forever.
	const thresholds = $derived.by(() => {
		const rates = rows.map((r) => (r.registeredVoters ? r.pledges / r.registeredVoters : 0)).filter((r) => r > 0);
		if (rates.length === 0) return [0, 0, 0];
		const sorted = [...rates].sort((a, b) => a - b);
		const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
		return [at(0.25), at(0.5), at(0.75)];
	});
	function fillFor(slug: string): string {
		const pledges = byPledges.get(slug) ?? 0;
		if (pledges === 0) return 'var(--surface-2)';
		const rate = byRate.get(slug) ?? 0;
		const step = rate <= thresholds[0] ? 0 : rate <= thresholds[1] ? 1 : rate <= thresholds[2] ? 2 : 3;
		return `color-mix(in oklab, var(--primary) ${STEPS[step]}, var(--surface))`;
	}
	function tipFor(slug: string): string {
		const pledges = byPledges.get(slug) ?? 0;
		const voters = byVoters.get(slug) ?? 0;
		const pct = voters ? `${((pledges / voters) * 100).toFixed(2)}%` : 'n/a';
		return `${pledges} pledge${pledges === 1 ? '' : 's'} · ${pct} of ${voters.toLocaleString()} voters`;
	}
</script>

{#if map}
	<svg viewBox={map.viewBox} class="h-auto w-full" role="img" aria-label="Ward map">
		{#each map.shapes as shape (shape.slug)}
			<path
				d={shape.d}
				fill={fillFor(shape.slug)}
				stroke={selectedSlug === shape.slug ? 'var(--primary)' : 'var(--surface)'}
				stroke-width={selectedSlug === shape.slug ? 3 : 1.5}
				class="cursor-pointer transition-[filter] hover:brightness-95 focus:outline-none"
				tabindex="0"
				role="button"
				aria-label={shape.slug}
				use:tooltip={tipFor(shape.slug)}
				onclick={() => onSelect?.(shape.slug)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onSelect?.(shape.slug);
					}
				}}
			/>
		{/each}
	</svg>
{:else}
	<div class="flex aspect-square w-full items-center justify-center text-sm text-muted">Loading map…</div>
{/if}
