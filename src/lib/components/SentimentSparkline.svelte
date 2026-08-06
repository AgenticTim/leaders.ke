<script lang="ts">
	import { tooltip } from '$lib/effects';

	// Coverage tone for one leader: weekly bars above or below a zero baseline,
	// plotting positive minus negative mentions.
	//
	// Net tone rather than raw volume because two thirds of all coverage is
	// classified neutral, and a line that spends most of its life flat sells
	// nothing. Polarity is carried by WHICH SIDE of the baseline a bar sits on,
	// so the colours reinforce a position encoding rather than being the only
	// channel (which is what makes the light-mode green/red pair legal, see
	// SentimentDot for the same reasoning).
	//
	// The caller passes DAILY values; they're bucketed into weeks here. Plotting
	// raw days doesn't fit: at this width 90 days is 0.4px per bar (and even 30
	// was 0.83px, with gaps eating half the chart). A week is also the honest
	// grain for "how is coverage trending" on a politician.
	let {
		series,
		name,
		days = 90,
		class: className = ''
	}: { series: number[]; name: string; days?: number; class?: string } = $props();

	// Below this there isn't a trend to draw, just noise: a couple of data points
	// would render as a confident-looking line about nothing.
	const MIN_ARTICLES = 5;
	const total = $derived(series.reduce((sum, v) => sum + Math.abs(v), 0));
	const enough = $derived(total >= MIN_ARTICLES);

	const W = 54;
	const H = 16;
	const MID = H / 2;
	const GAP = 1; // surface gap so adjacent weeks read as separate marks
	const BUCKET_DAYS = 7;

	// Oldest bucket first, so the x-axis runs left to right in time. The final
	// bucket is the current (possibly part) week.
	const buckets = $derived.by(() => {
		const out: number[] = [];
		for (let i = 0; i < series.length; i += BUCKET_DAYS) {
			out.push(series.slice(i, i + BUCKET_DAYS).reduce((sum, v) => sum + v, 0));
		}
		return out;
	});

	const peak = $derived(Math.max(1, ...buckets.map((v) => Math.abs(v))));
	const barW = $derived((W - GAP * (buckets.length - 1)) / buckets.length);
	const bars = $derived(
		buckets.map((v) => {
			// Every week gets a mark: a quiet week is a hairline on the baseline, so
			// it reads as "covered, nothing happened" rather than as a gap.
			const h = v === 0 ? 1 : (Math.abs(v) / peak) * (MID - 1);
			return {
				y: v >= 0 ? MID - h : MID,
				h: Math.max(1, h),
				tone: v > 0 ? 'var(--tone-positive)' : v < 0 ? 'var(--tone-negative)' : 'var(--tone-neutral)'
			};
		})
	);

	// Direct label: the sparkline shows the shape, this says which way it went.
	const net = $derived(series.reduce((sum, v) => sum + v, 0));
	const summary = $derived(
		net > 0 ? 'Net positive coverage' : net < 0 ? 'Net negative coverage' : 'Balanced coverage'
	);
	const months = $derived(Math.round(days / 30));
	const window = $derived(months <= 1 ? 'month' : `${months} months`);
</script>

{#if enough}
	<!-- relative z-10: inside LeaderCard this sits within the name's stretched
	link (after:absolute after:inset-0), which otherwise covers the mark and eats
	the hover, so the tooltip never fires. -->
	<span
		class="relative z-10 inline-flex shrink-0 items-center align-middle {className}"
		use:tooltip={`${name}: ${summary} over the last ${window}, ${total} classified mentions, one bar per week`}
		aria-label="{name}: {summary} over the last {window}, based on {total} automatically classified mentions"
	>
		<svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-hidden="true" class="overflow-visible">
			<!-- Recessive baseline: the zero line the polarity is read against. -->
			<line x1="0" y1={MID} x2={W} y2={MID} stroke="currentColor" stroke-width="0.5" opacity="0.25" />
			{#each bars as bar, i (i)}
				<rect x={i * (barW + GAP)} y={bar.y} width={barW} height={bar.h} rx="0.5" fill={bar.tone} />
			{/each}
		</svg>
	</span>
{/if}
