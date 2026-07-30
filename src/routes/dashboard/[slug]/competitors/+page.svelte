<script lang="ts">
	import type { PageProps } from './$types';
	import type { SentimentBreakdown } from './+page.server';

	let { data }: PageProps = $props();

	const fmt = new Intl.NumberFormat('en-KE');
	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	// Width of each stacked-bar segment as a percentage of total classified
	// coverage; an all-zero breakdown (no coverage yet) renders as an empty bar.
	const segments = (s: SentimentBreakdown) => {
		const total = s.positive + s.neutral + s.negative;
		if (!total) return { positive: 0, neutral: 0, negative: 0 };
		return {
			positive: (s.positive / total) * 100,
			neutral: (s.neutral / total) * 100,
			negative: (s.negative / total) * 100
		};
	};
	const totalOf = (s: SentimentBreakdown) => s.positive + s.neutral + s.negative;
	const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

	// Color for a per-bucket delta: more positive coverage is good (green), more
	// negative coverage is bad (red) — same direction never means the same
	// thing for both, so `bad` flips which sign is red. Neutral has no
	// good/bad direction, so it's passed with bad: null and never colors.
	const deltaColor = (d: number, bad: 'above' | 'below' | null) => {
		if (bad === null || d === 0) return '';
		const isBad = bad === 'above' ? d > 0 : d < 0;
		return isBad ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
	};

	// Whole-seat comparison point: every rival's coverage summed into one
	// breakdown, so "your" tone reads against something instead of floating
	// alone, the same reason the followers column already highlights whoever
	// leads.
	const seatTotals = $derived(
		data.rivals.reduce<SentimentBreakdown>(
			(acc, r) => {
				const s = r.sentiment;
				if (!s) return acc;
				return {
					positive: acc.positive + s.positive,
					neutral: acc.neutral + s.neutral,
					negative: acc.negative + s.negative
				};
			},
			{ positive: 0, neutral: 0, negative: 0 }
		)
	);
</script>

{#snippet toneBar(s: SentimentBreakdown, height: string)}
	{@const w = segments(s)}
	<div class="flex {height} w-full overflow-hidden rounded-full bg-surface-2">
		<div class="h-full bg-emerald-500" style="width: {w.positive}%"></div>
		<div class="h-full bg-muted" style="width: {w.neutral}%"></div>
		<div class="h-full bg-red-500" style="width: {w.negative}%"></div>
	</div>
{/snippet}

<!-- Head-to-head: not just the rival's own tone, but how it stacks up against
yours, the point of a Competitors tab is "am I ahead or behind", not a fact in
isolation. -->
{#snippet sentimentCompare(rivalName: string, rival: SentimentBreakdown, mine: SentimentBreakdown)}
	{@const rivalTotal = totalOf(rival)}
	{@const mineTotal = totalOf(mine)}
	{#if rivalTotal === 0}
		<p class="text-sm text-muted">No classified coverage yet for {rivalName}.</p>
	{:else}
		<p class="text-xs font-medium text-muted">{rivalName}</p>
		<div class="mt-1">{@render toneBar(rival, 'h-3')}</div>
		<div class="flex flex-col sm:flex-row justify-between">
			<span class="mt-1 text-xs text-muted">
				{pct(rival.positive, rivalTotal)}% pos · {pct(rival.neutral, rivalTotal)}% neu · {pct(
					rival.negative,
					rivalTotal
				)}% neg
			</span>
			{#if mineTotal > 0}
				{@const dPos = pct(rival.positive, rivalTotal) - pct(mine.positive, mineTotal)}
				{@const dNeu = pct(rival.neutral, rivalTotal) - pct(mine.neutral, mineTotal)}
				{@const dNeg = pct(rival.negative, rivalTotal) - pct(mine.negative, mineTotal)}
				<!-- vs your own tone above: how many points higher/lower this rival runs
				in each bucket, same pos/neu/neg order as the line above it. -->
				<span class="mt-1 text-xs text-muted">
					VS You: {#each [{ d: dPos, bad: 'below' as const }, { d: dNeu, bad: null }, { d: dNeg, bad: 'above' as const }] as b, i (i)}{i >
						0
							? ', '
							: ''}<span class={deltaColor(b.d, b.bad)}>{b.d > 0 ? '+' : ''}{b.d}pts</span>{/each}
				</span>
			{/if}
		</div>
	{/if}
{/snippet}

<svelte:head><title>Competitors — vote.ke</title></svelte:head>

<h2 class="text-lg font-semibold text-heading">The race for {data.seat}</h2>
<p class="mt-1 text-sm text-muted">
	Everyone else contesting your seat, ranked by followers. Your numbers first for comparison.
</p>

<!-- Your baseline -->
<div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
	{#each [{ value: data.mine.followers, label: 'Your followers' }, { value: data.mine.postCount, label: 'Your public posts' }, { value: data.mine.pillarCount, label: 'Your pillars' }, { value: data.mine.mentionCount, label: 'Your news mentions' }] as stat (stat.label)}
		<div class="rounded-2xl border border-primary bg-surface p-4">
			<p class="text-2xl font-extrabold tabular-nums text-heading">{fmt.format(stat.value)}</p>
			<p class="mt-1 text-xs text-muted">{stat.label}</p>
		</div>
	{/each}
</div>

<!-- Sentiment Intelligence Suite (Dominate perk): tone of coverage, yours and
rivals', a locked tab gets an upsell instead of the breakdown/column below. -->
{#if data.sentimentUnlocked}
	{@const mine = data.mine.sentiment!}
	{@const mineTotal = totalOf(mine)}
	{@const seatTotal = totalOf(seatTotals)}
	<div
		class="mt-6 rounded-2xl border border-primary bg-gradient-to-br from-primary-soft to-surface p-6"
	>
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-xl font-bold text-heading">Sentiment Intelligence</h2>
			<p class="text-xs font-medium text-muted">
				{fmt.format(mineTotal)} classified mention{mineTotal === 1 ? '' : 's'}
			</p>
		</div>
		<p class="mt-1 text-sm text-muted">
			How the coverage of you and your rivals is trending, positive, neutral, or negative.
		</p>

		{#if mineTotal === 0}
			<p class="mt-6 text-sm text-muted">
				No classified coverage yet, check back once the news crawl picks something up.
			</p>
		{:else}
			<!-- Big tone tiles: the headline read, at a glance. -->
			<div class="mt-5 grid grid-cols-3 gap-3">
				{#each [{ key: 'positive', label: 'Positive', n: mine.positive, accent: 'border-emerald-500 text-emerald-600 dark:text-emerald-400' }, { key: 'neutral', label: 'Neutral', n: mine.neutral, accent: 'border-muted text-heading' }, { key: 'negative', label: 'Negative', n: mine.negative, accent: 'border-red-500 text-red-600 dark:text-red-400' }] as tile (tile.key)}
					<div class="rounded-2xl border-2 bg-surface p-4 text-center {tile.accent}">
						<p class="text-3xl font-extrabold tabular-nums">{pct(tile.n, mineTotal)}%</p>
						<p class="mt-1 text-xs font-semibold uppercase tracking-wide">{tile.label}</p>
						<p class="text-xs text-muted">{fmt.format(tile.n)} mention{tile.n === 1 ? '' : 's'}</p>
					</div>
				{/each}
			</div>

			<!-- Full-width tone bar, bigger and labeled directly on the segments. -->
			{@const w = segments(mine)}
			<div
				class="mt-5 flex h-6 w-full overflow-hidden rounded-full bg-surface-2 text-xs font-semibold text-white"
			>
				{#if w.positive > 0}
					<div
						class="flex h-full items-center justify-center overflow-hidden bg-emerald-500"
						style="width: {w.positive}%"
					>
						{#if w.positive >= 12}{Math.round(w.positive)}%{/if}
					</div>
				{/if}
				{#if w.neutral > 0}
					<div
						class="flex h-full items-center justify-center overflow-hidden bg-muted"
						style="width: {w.neutral}%"
					>
						{#if w.neutral >= 12}{Math.round(w.neutral)}%{/if}
					</div>
				{/if}
				{#if w.negative > 0}
					<div
						class="flex h-full items-center justify-center overflow-hidden bg-red-500"
						style="width: {w.negative}%"
					>
						{#if w.negative >= 12}{Math.round(w.negative)}%{/if}
					</div>
				{/if}
			</div>

			<!-- Seat comparison: where you sit against the combined rival coverage. -->
			{#if seatTotal > 0}
				<p class="mt-4 text-sm text-muted">
					Seat average across {fmt.format(data.rivals.length)} rival{data.rivals.length === 1
						? ''
						: 's'}:
					<span class="font-semibold text-heading"
						>{pct(seatTotals.positive, seatTotal)}% positive</span
					>
					{#if pct(mine.positive, mineTotal) > pct(seatTotals.positive, seatTotal)}
						<span class="font-semibold text-emerald-600 dark:text-emerald-400"
							>, you're leading the seat on positive coverage.</span
						>
					{:else if pct(mine.positive, mineTotal) < pct(seatTotals.positive, seatTotal)}
						<span class="font-semibold text-red-600 dark:text-red-400"
							>, you're trailing the seat on positive coverage.</span
						>
					{:else}
						<span>, you're tied with the seat average.</span>
					{/if}
				</p>
			{/if}
		{/if}
	</div>
{:else}
	<div
		class="mt-6 rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted"
	>
		<a href="/pricing" class="font-semibold text-primary hover:underline"
			>Upgrade to the Dominate Package</a
		> to see whether coverage of you AND your rivals is trending positive or negative.
	</div>
{/if}

{#if data.rivals.length > 0}
	<div class="mt-6 overflow-x-auto rounded-2xl border border-border">
		<table class="w-full min-w-160 border-collapse text-left">
			<thead>
				<tr class="bg-surface-2">
					<th class="px-4 py-3 text-sm font-semibold text-heading">Rival</th>
					<th class="px-4 py-3 text-sm font-semibold text-heading">Followers</th>
					<th class="px-4 py-3 text-sm font-semibold text-heading">Posts</th>
					<th class="px-4 py-3 text-sm font-semibold text-heading">Pillars</th>
					<th class="px-4 py-3 text-sm font-semibold text-heading">Mentions</th>
					<th class="px-4 py-3 text-sm font-semibold text-heading">Latest post</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rivals as rival (rival.path)}
					<tr class="border-t border-border">
						<td class="px-4 py-3">
							<a href={rival.path} class="text-sm font-medium text-heading hover:text-primary">
								{rival.name}
							</a>
							<p class="text-xs text-muted capitalize">
								{rival.status}{rival.party ? ` · ${rival.party}` : ''}{rival.verified
									? ' · ✓ verified'
									: ''}
							</p>
						</td>
						<td
							class="px-4 py-3 text-sm font-semibold tabular-nums {rival.followers >
							data.mine.followers
								? 'text-primary'
								: 'text-heading'}"
						>
							{fmt.format(rival.followers)}
						</td>
						<td class="px-4 py-3 text-sm tabular-nums">{rival.postCount}</td>
						<td class="px-4 py-3 text-sm tabular-nums">{rival.pillarCount}</td>
						<td class="px-4 py-3 text-sm tabular-nums">{rival.mentionCount}</td>
						<td class="px-4 py-3 text-sm text-muted">
							{#if rival.latestPost}
								{rival.latestPost.title}
								<span class="text-xs">({dateFmt.format(new Date(rival.latestPost.createdAt))})</span
								>
							{:else}
								—
							{/if}
						</td>
					</tr>
					{#if data.sentimentUnlocked}
						<tr class="border-t border-border bg-surface-2/50">
							<td colspan="6" class="px-4 py-3">
								{@render sentimentCompare(rival.name, rival.sentiment!, data.mine.sentiment!)}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="mt-6 rounded-2xl border border-dashed border-border p-8 text-center">
		<p class="font-semibold text-heading">No declared rivals yet</p>
		<p class="mx-auto mt-2 max-w-md text-sm text-muted">
			When other candidates claim profiles for your seat, their public numbers appear here.
		</p>
	</div>
{/if}
