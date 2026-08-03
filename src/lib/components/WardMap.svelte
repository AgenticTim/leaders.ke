<script lang="ts">
	import { tooltip } from '$lib/effects';

	// Generic choropleth: colors the seat's own wards (or, for a national
	// scope, every county) by `value`. Shapes come from
	// src/lib/data/wardMaps/<key>.json (built by scripts/build-ward-maps.ts
	// from the same boundary polygons locateSeat.ts uses), lazy-loaded per key
	// so a visitor only ever downloads the one map they're looking at.
	let {
		mapKey,
		rows,
		unit,
		totalLabel = 'voters',
		colorBy = 'rate',
		showRate = true,
		selectedSlug = null,
		onSelect
	}: {
		/** County slug (ward-level map) or 'national' (county-outline map). */
		mapKey: string;
		rows: { slug: string; value: number; total: number }[];
		/** Singular noun for the tooltip, e.g. "pledge" or "gen-z voter". */
		unit: string;
		/** What `total` counts, e.g. "voters". */
		totalLabel?: string;
		/** What the color scale buckets on: 'rate' (value/total — the voter
		 * heatmap's pledge penetration, where areas genuinely differ) or
		 * 'value' (raw magnitude — demographics' gen-z count, where the
		 * per-capita RATE is a single county-wide constant applied to every
		 * ward by construction, so bucketing by rate there would color wards
		 * by rounding noise instead of the real, size-driven variation). */
		colorBy?: 'rate' | 'value';
		/** Whether the tooltip shows "X% of total" alongside the raw value.
		 * Off for maps where that rate is a single constant repeated on every
		 * area (same root cause as colorBy='value') — showing it there reads
		 * as a per-area stat but is really just echoing the shared input. */
		showRate?: boolean;
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

	const byRate = $derived(new Map(rows.map((r) => [r.slug, r.total ? r.value / r.total : 0])));
	const byValue = $derived(new Map(rows.map((r) => [r.slug, r.value])));
	const byTotal = $derived(new Map(rows.map((r) => [r.slug, r.total])));

	// Sequential scale, one hue (the brand primary), light→dark steps — never a
	// rainbow. Areas with a nonzero value are bucketed into quartiles of
	// whatever colorBy measures (so the scale reflects THIS map's own spread,
	// not a fixed global one); zero-value areas get a flat neutral "no data"
	// fill, kept visually distinct from "lowest non-zero bucket" rather than
	// starting the ramp at invisible. Mixed against the theme's own surface,
	// so both light and dark mode stay correct automatically.
	const STEPS = ['30%', '53%', '77%', '100%'];
	// Quartile boundaries (p25/p50/p75) split the non-zero measures into 4
	// bins; the max always falls in the last bin since nothing exceeds p75 by
	// definition — a fixed max-as-boundary would instead trap the top area in
	// the second-to-last step forever.
	const thresholds = $derived.by(() => {
		const measures = rows
			.map((r) => (colorBy === 'value' ? r.value : r.total ? r.value / r.total : 0))
			.filter((m) => m > 0);
		if (measures.length === 0) return [0, 0, 0];
		const sorted = [...measures].sort((a, b) => a - b);
		const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
		return [at(0.25), at(0.5), at(0.75)];
	});
	function fillFor(slug: string): string {
		const value = byValue.get(slug) ?? 0;
		if (value === 0) return 'var(--surface-2)';
		const measure = colorBy === 'value' ? value : (byRate.get(slug) ?? 0);
		const step = measure <= thresholds[0] ? 0 : measure <= thresholds[1] ? 1 : measure <= thresholds[2] ? 2 : 3;
		return `color-mix(in oklab, var(--primary) ${STEPS[step]}, var(--surface))`;
	}
	function tipFor(slug: string): string {
		const value = byValue.get(slug) ?? 0;
		const base = `${value.toLocaleString()} ${unit}${value === 1 ? '' : 's'}`;
		if (!showRate) return base;
		const total = byTotal.get(slug) ?? 0;
		const pct = total ? `${((value / total) * 100).toFixed(2)}%` : 'n/a';
		return `${base} · ${pct} of ${total.toLocaleString()} ${totalLabel}`;
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
