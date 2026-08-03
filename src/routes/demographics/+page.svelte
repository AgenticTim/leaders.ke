<script lang="ts">
	import { tooltip } from '$lib/effects';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const fmt = new Intl.NumberFormat('en-KE');
	const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

	// Single-measure age distribution: one hue (the brand primary), magnitude
	// carried by length, labels in text tokens; no categorical palette needed.
	const maxBandShare = $derived(Math.max(...data.ageBands.map((b) => b.share), 0.0001));

	function onCountyChange(e: Event) {
		const slug = (e.currentTarget as HTMLSelectElement).value;
		goto(slug ? `?county=${slug}` : '/demographics', { noScroll: true });
	}

	// Constituency accordions (county view): open one at a time.
	let openConstituency = $state<string | null>(null);

	// National totals for the Voters by county table; the share is weighted
	// (total gen-z estimate over total register), not an average of shares.
	const countyTotals = $derived.by(() => {
		if (!data.countyRollup) return null;
		const voters = data.countyRollup.reduce((sum, row) => sum + row.voters, 0);
		const genZEst = data.countyRollup.reduce((sum, row) => sum + row.genZEst, 0);
		return { voters, genZEst, genZShare: voters ? genZEst / voters : 0 };
	});
</script>

<svelte:head>
	<title>Voter Demographics | vote.ke</title>
	<meta
		name="description"
		content="Kenya's 2027 voter demographics: gen-z, youth and age-structure analysis nationally, per county, and estimated down to every constituency and ward."
	/>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight text-heading">Voter Demographics</h1>
			<p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
				Who can vote in 2027, by generation and age band: {data.censusYear} census age structure
				projected to election day, joined with the IEBC 2022 register.
			</p>
		</div>
		<label class="shrink-0">
			<span class="text-sm font-medium text-heading">Scope</span>
			<select
				value={data.countySlug}
				onchange={onCountyChange}
				class="mt-1.5 block w-full rounded-full border border-border bg-surface px-4 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none sm:w-56"
			>
				<option value="">Kenya (national)</option>
				{#each data.countyOptions as option (option.slug)}
					<option value={option.slug}>{option.name}</option>
				{/each}
			</select>
		</label>
	</div>

	<!-- Headline stats for the selected scope -->
	<div class="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
		<div class="rounded-3xl border border-border bg-surface p-5">
			<p class="text-sm text-muted">Population ({data.censusYear})</p>
			<p class="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-heading sm:text-3xl">{fmt.format(data.stats.population)}</p>
		</div>
		<div class="rounded-3xl border border-border bg-surface p-5">
			<p class="text-sm text-muted">Registered voters (2022)</p>
			<p class="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-heading sm:text-3xl">{fmt.format(data.stats.registered)}</p>
		</div>
		<div class="rounded-3xl border border-border bg-surface p-5">
			<p class="text-sm text-muted">Voting-age by Aug 2027 <span class="text-xs">(est.)</span></p>
			<p class="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-heading sm:text-3xl">{fmt.format(data.stats.votingAge2027)}</p>
		</div>
		<div class="rounded-3xl border border-border bg-surface p-5">
			<p class="text-sm text-muted">Gen-z eligible 2027 <span class="text-xs">(est.)</span></p>
			<p class="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-primary sm:text-3xl">{fmt.format(data.stats.genZEligible2027)}</p>
			<p class="mt-1 text-xs text-muted">{pct(data.stats.genZShare2027)} of the 2027 voting-age est.</p>
		</div>
	</div>

	<!-- Generation lens -->
	<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-3xl border border-border bg-surface-2 p-5">
			<p class="text-sm font-semibold text-heading">Gen-z (born 1997-2012)</p>
			<p class="mt-1 text-xl font-extrabold tabular-nums text-heading">{fmt.format(data.stats.genZEligible2027)} <span class="text-sm font-medium text-muted">eligible</span></p>
			<p class="mt-1 text-xs leading-relaxed text-muted">≈ {fmt.format(data.stats.genZRegisteredEst)} of today's registered voters, if registration mirrors the age structure.</p>
		</div>
		<div class="rounded-3xl border border-border bg-surface-2 p-5">
			<p class="text-sm font-semibold text-heading">Youth (18-34 in 2027)</p>
			<p class="mt-1 text-xl font-extrabold tabular-nums text-heading">{fmt.format(data.stats.youth2027)}</p>
			<p class="mt-1 text-xs leading-relaxed text-muted">The bloc every 2027 campaign is chasing.</p>
		</div>
		<div class="rounded-3xl border border-border bg-surface-2 p-5">
			<p class="text-sm font-semibold text-heading">Millennials (born 1981-1996)</p>
			<p class="mt-1 text-xl font-extrabold tabular-nums text-heading">{fmt.format(data.stats.millennials2027)}</p>
			<p class="mt-1 text-xs leading-relaxed text-muted">Peak-turnout generation in {data.scope}.</p>
		</div>
	</div>

	<!-- Age distribution: single-hue horizontal bars, natural age order -->
	<div class="mt-8 rounded-3xl border border-border bg-surface p-6">
		<h2 class="text-xl font-bold text-heading">Age structure · {data.scope}</h2>
		<p class="mt-1 text-sm text-muted">{data.censusYear} census population by five-year band.</p>
		<div class="mt-5 space-y-1.5">
			{#each data.ageBands as row (row.band)}
				<div class="flex items-center gap-3" use:tooltip={`${row.band}: ${fmt.format(row.count)} (${pct(row.share)})`}>
					<span class="w-12 shrink-0 text-right text-xs tabular-nums text-muted">{row.band}</span>
					<div class="h-4 flex-1 overflow-hidden rounded-r bg-surface-2">
						<div class="h-full rounded-r bg-primary" style="width: {(row.share / maxBandShare) * 100}%"></div>
					</div>
					<span class="w-20 shrink-0 text-xs tabular-nums text-muted">{fmt.format(row.count)}</span>
				</div>
			{/each}
		</div>
	</div>

	{#if data.countyRollup}
		<!-- National view: county leaderboard with gen-z share/estimate columns -->
		<div class="mt-8 rounded-3xl border border-border bg-surface p-6">
			<h2 class="text-xl font-bold text-heading">Voters by county</h2>
			<p class="mt-1 text-sm text-muted">
				Each county's registered voters with the estimated gen-z among them (county age share × 2022 register), largest first.
			</p>
			<div class="mt-4 overflow-x-auto">
				<table class="w-full min-w-120 text-sm">
					<thead>
						<tr class="border-b border-border text-left text-xs text-muted uppercase tracking-wide">
							<th class="py-2 pr-3 font-semibold">County</th>
							<th class="py-2 pr-3 text-right font-semibold">Registered (2022)</th>
							<th class="py-2 pr-3 text-right font-semibold">Gen-z share</th>
							<th class="py-2 text-right font-semibold">Gen-z est.</th>
						</tr>
					</thead>
					<tbody>
						{#each data.countyRollup as row (row.slug)}
							<tr class="border-b border-border last:border-b-0">
								<td class="py-2 pr-3"><a href="?county={row.slug}" class="font-medium text-heading hover:text-primary hover:underline">{row.name}</a></td>
								<td class="py-2 pr-3 text-right tabular-nums">{fmt.format(row.voters)}</td>
								<td class="py-2 pr-3 text-right tabular-nums">{pct(row.genZShare)}</td>
								<td class="py-2 text-right font-semibold tabular-nums text-heading">{fmt.format(row.genZEst)}</td>
							</tr>
						{/each}
					</tbody>
					{#if countyTotals}
						<tfoot>
							<tr class="border-t-2 border-border">
								<td class="py-2 pr-3 font-semibold text-heading">Kenya (total)</td>
								<td class="py-2 pr-3 text-right font-semibold tabular-nums text-heading">{fmt.format(countyTotals.voters)}</td>
								<td class="py-2 pr-3 text-right font-semibold tabular-nums text-heading">{pct(countyTotals.genZShare)}</td>
								<td class="py-2 text-right font-semibold tabular-nums text-heading">{fmt.format(countyTotals.genZEst)}</td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
		</div>
	{/if}

	{#if data.seats}
		<!-- County view: constituency + ward estimates -->
		<div class="mt-8 rounded-3xl border border-border bg-surface p-6">
			<h2 class="text-xl font-bold text-heading">Voters by constituency and ward · {data.scope}</h2>
			<p class="mt-1 text-sm text-muted">
				County age share ({pct(data.stats.genZShare2027)}) applied to each seat's 2022 registered voters, an estimate, since sub-county age data isn't published.
			</p>
			<div class="mt-4 space-y-2">
				{#each data.seats as constituency (constituency.name)}
					<div class="rounded-2xl border border-border">
						<button
							type="button"
							onclick={() => (openConstituency = openConstituency === constituency.name ? null : constituency.name)}
							class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
						>
							<span class="font-semibold text-heading">{constituency.name}</span>
							<span class="text-sm tabular-nums text-muted">
								{fmt.format(constituency.voters)} reg · <span class="font-semibold text-heading">{fmt.format(constituency.genZEst)} gen-z est.</span>
								<span class="ml-2">{openConstituency === constituency.name ? '−' : '+'}</span>
							</span>
						</button>
						{#if openConstituency === constituency.name}
							<div class="border-t border-border px-4 py-2">
								{#each constituency.wards as ward (ward.name)}
									<div class="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
										<span>{ward.name}</span>
										<span class="tabular-nums text-muted">{fmt.format(ward.voters)} reg · <span class="font-medium text-heading">{fmt.format(ward.genZEst)}</span></span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Methodology & sources -->
	<div class="mt-8 rounded-3xl bg-surface-2 p-6 text-sm leading-relaxed text-muted">
		<h2 class="font-semibold text-heading">Methodology & sources</h2>
		<ul class="mt-2 list-disc space-y-1 pl-5">
			<li>
				Age structure: {data.source}, from the {data.censusYear} census county tables
				(<a href="https://data.humdata.org/dataset/cod-ps-ken" target="_blank" rel="noopener" class="underline hover:text-heading" use:tooltip={'United Nations Office for the Coordination of Humanitarian Affairs'}>KNBS via OCHA</a>).
			</li>
			<li>Registered voters: IEBC 2022 General Election register (per ward), the same figures behind every seat page here.</li>
			<li>2027 projections age the census cohorts forward to August 2027 (whoever was N years old in 2019 is N+8), ignoring mortality and migration; treat them as estimates.</li>
			<li>Gen-z = born 1997-2012; those born by August 2009 are eligible in 2027. Constituency and ward figures apply the county's age share to the seat's registered voters.</li>
			<li>These are eligibility and registration figures, never turnout predictions.</li>
		</ul>
	</div>
</section>
