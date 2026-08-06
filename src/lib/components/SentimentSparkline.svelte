<script lang="ts">
	import { tooltip } from '$lib/effects';

	// 30-day coverage tone for one leader: one bar per day, above or below a zero
	// baseline, plotting positive minus negative mentions.
	//
	// Net tone rather than raw volume because two thirds of all coverage is
	// classified neutral, and a line that spends most of its life flat sells
	// nothing. Polarity is carried by WHICH SIDE of the baseline a bar sits on,
	// so the colours reinforce a position encoding rather than being the only
	// channel (which is what makes the light-mode green/red pair legal, see
	// SentimentDot for the same reasoning).
	let {
		series,
		name,
		class: className = ''
	}: { series: number[]; name: string; class?: string } = $props();

	// Below this there isn't a trend to draw, just noise: two data points would
	// render as a confident-looking line about nothing.
	const MIN_ARTICLES = 5;
	const total = $derived(series.reduce((sum, v) => sum + Math.abs(v), 0));
	const enough = $derived(total >= MIN_ARTICLES);

	const W = 54;
	const H = 16;
	const MID = H / 2;
	const GAP = 1; // 1px surface gap keeps adjacent days legible as separate marks

	const peak = $derived(Math.max(1, ...series.map((v) => Math.abs(v))));
	const barW = $derived((W - GAP * (series.length - 1)) / series.length);
	const bars = $derived(
		series.map((v, i) => {
			// Every day gets a mark: a zero day is a hairline on the baseline, so a
			// quiet stretch reads as "covered, nothing happened" and not as a gap.
			const h = v === 0 ? 1 : (Math.abs(v) / peak) * (MID - 1);
			return {
				x: i * (barW + GAP),
				y: v >= 0 ? MID - h : MID,
				h: Math.max(1, h),
				tone: v > 0 ? 'var(--tone-positive)' : v < 0 ? 'var(--tone-negative)' : 'var(--tone-neutral)'
			};
		})
	);

	// Direct label: the sparkline shows the shape, this says which way it went.
	const net = $derived(series.reduce((sum, v) => sum + v, 0));
	const summary = $derived(
		net > 0 ? `Net positive coverage` : net < 0 ? `Net negative coverage` : `Balanced coverage`
	);
</script>

{#if enough}
	<span
		class="inline-flex shrink-0 items-center align-middle {className}"
		use:tooltip={`${name}: ${summary} over the last 30 days, ${total} classified mentions`}
		aria-label="{name}: {summary} over the last 30 days, based on {total} automatically classified mentions"
	>
		<svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-hidden="true" class="overflow-visible">
			<!-- Recessive baseline: the zero line the polarity is read against. -->
			<line x1="0" y1={MID} x2={W} y2={MID} stroke="currentColor" stroke-width="0.5" opacity="0.25" />
			{#each bars as bar, i (i)}
				<rect x={bar.x} y={bar.y} width={barW} height={bar.h} rx="0.5" fill={bar.tone} />
			{/each}
		</svg>
	</span>
{/if}
