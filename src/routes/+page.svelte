<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import BallotDisclaimer from '$lib/components/BallotDisclaimer.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { fly } from 'svelte/transition';
	import GeoSelect from '$lib/components/GeoSelect.svelte';
	import QuickSearch from '$lib/components/QuickSearch.svelte';
	import type { BallotLevel } from '$lib/server/ballot';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const LEVEL_HEADING: Record<BallotLevel, string> = {
		president: 'Pick Your President',
		governor: 'Pick Your Governor',
		senator: 'Pick Your Senator',
		womanRep: 'Pick Your Woman Rep',
		mp: 'Pick Your MP',
		mca: 'Pick Your MCA'
	};
	const SEAT_ORDER: BallotLevel[] = ['president', 'governor', 'senator', 'womanRep', 'mp', 'mca'];

	// Muted subtitle under each seat heading, naming the region it's actually for
	// (president is national, so it gets none). Only shown once that region is
	// picked — while it's still missing the heading below already explains that.
	function levelRegion(level: BallotLevel): string {
		switch (level) {
			case 'president':
				return 'A simulated voting experience';
			case 'governor':
			case 'senator':
			case 'womanRep':
				return data.countyName ? `${data.countyName} County` : '';
			case 'mp':
				return data.constituencyName ? `${data.constituencyName} Constituency` : '';
			case 'mca':
				return data.wardName ? `${data.wardName} Ward` : '';
			default:
				return '';
		}
	}

	// The booth is a wizard, not a page: one full-viewport step at a time, no
	// vertical scrolling anywhere — wide option sets wrap into extra columns and
	// overflow horizontally instead. Region picks are their own steps, injected
	// right before the first seat that needs them.
	type Region = 'county' | 'constituency' | 'ward';
	type Step = { kind: 'seat'; level: BallotLevel } | { kind: 'region'; region: Region };
	const STEPS: Step[] = [
		{ kind: 'seat', level: 'president' },
		{ kind: 'region', region: 'county' },
		{ kind: 'seat', level: 'governor' },
		{ kind: 'seat', level: 'senator' },
		{ kind: 'seat', level: 'womanRep' },
		{ kind: 'region', region: 'constituency' },
		{ kind: 'seat', level: 'mp' },
		{ kind: 'region', region: 'ward' },
		{ kind: 'seat', level: 'mca' }
	];
	let stepIndex = $state(0);
	const step = $derived(STEPS[stepIndex]);

	let county = $state(data.countySlug);
	let constituency = $state(data.constituencySlug);
	let ward = $state(data.wardSlug);

	// Keep local values in sync with the URL (browser back/forward, direct links) —
	// but only when it actually specifies a region. A reload with no geo in the URL
	// (e.g. straight back to "/" after casting a vote) isn't a deliberate "clear the
	// selection", so it must never stomp whatever GeoSelect just restored from the
	// remembered (localStorage) selection or the citizen's own in-session pick.
	$effect(() => {
		if (data.countySlug) county = data.countySlug;
		if (data.constituencySlug) constituency = data.constituencySlug;
		if (data.wardSlug) ward = data.wardSlug;
	});

	function regionValue(region: Region): string {
		return region === 'county' ? county : region === 'constituency' ? constituency : ward;
	}

	// One candidateId (or null if skipped) per level; `decided` gates the cast button.
	let selections = $state<Record<BallotLevel, string | null>>({
		president: null,
		governor: null,
		senator: null,
		womanRep: null,
		mp: null,
		mca: null
	});
	let decided = $state<Record<BallotLevel, boolean>>({
		president: false,
		governor: false,
		senator: false,
		womanRep: false,
		mp: false,
		mca: false
	});

	function resetLevels(levels: BallotLevel[]) {
		for (const level of levels) {
			selections[level] = null;
			decided[level] = false;
		}
	}

	async function syncGeoToUrl() {
		const params = new URLSearchParams();
		if (county) params.set('county', county);
		if (constituency) params.set('constituency', constituency);
		if (ward) params.set('ward', ward);
		await goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	// The always-visible GeoSelect bar: changing a region there invalidates every
	// pick that depended on it before reloading candidates.
	function onGeoChange() {
		if (county !== data.countySlug) resetLevels(['governor', 'senator', 'womanRep', 'mp', 'mca']);
		else if (constituency !== data.constituencySlug) resetLevels(['mp', 'mca']);
		else if (ward !== data.wardSlug) resetLevels(['mca']);
		syncGeoToUrl();
	}

	// Advance skips region steps whose value is already set (e.g. via the bar
	// below); going back never skips them, so any region can be re-picked.
	function goNext() {
		let i = stepIndex + 1;
		while (i < STEPS.length - 1) {
			const s = STEPS[i];
			if (s.kind === 'region' && regionValue(s.region)) i++;
			else break;
		}
		stepIndex = Math.min(i, STEPS.length - 1);
	}
	function goBack() {
		if (stepIndex > 0) stepIndex--;
	}

	function pick(level: BallotLevel, candidateId: string) {
		selections[level] = candidateId;
		decided[level] = true;
		goNext();
	}
	function skip(level: BallotLevel) {
		selections[level] = null;
		decided[level] = true;
		goNext();
	}

	// Aspirational write-ins: the quick search on every seat step lets a citizen
	// pick ANY profile on the platform for that seat, vying for it or not. Stored
	// as "person:<slug>" (resolved live by resolveCandidateById, like campaign
	// picks); names are kept here so the chip can show who was written in.
	let writeInNames = $state<Record<string, string>>({});
	function pickWriteIn(level: BallotLevel, item: { label: string; path: string }) {
		const slug = item.path.replace(/^\//, '');
		if (!slug || slug.includes('/')) return;
		writeInNames[`person:${slug}`] = item.label;
		pick(level, `person:${slug}`);
	}
	function clearWriteIn(level: BallotLevel) {
		selections[level] = null;
		decided[level] = false;
	}

	async function pickRegion(region: Region, slug: string) {
		if (region === 'county') {
			county = slug;
			constituency = '';
			ward = '';
			resetLevels(['governor', 'senator', 'womanRep', 'mp', 'mca']);
		} else if (region === 'constituency') {
			constituency = slug;
			ward = '';
			resetLevels(['mp', 'mca']);
		} else {
			ward = slug;
			resetLevels(['mca']);
		}
		await syncGeoToUrl();
		goNext();
	}

	function candidatesFor(level: BallotLevel) {
		return data.levels.find((l) => l.level === level)?.candidates ?? null;
	}

	// Every card is the stacked square design (avatar above centered text); only
	// the ARRANGEMENT adapts to the field size below lg: 1 = centered hero,
	// 2 = side by side, 3 = vertical list, 4+ = two-column grid (odd remainders
	// center on their own row via flex-wrap + justify-center). On lg+ every
	// count renders the large cards (grow to a cap, wrap, rows centered).
	const LG_CONTAINER = 'lg:mx-auto lg:w-full lg:max-w-7xl lg:flex-row lg:flex-wrap lg:justify-center lg:gap-3';
	const LG_CARD = 'lg:w-auto lg:basis-60 lg:max-w-90 lg:grow lg:p-4 lg:text-center lg:text-sm';
	function candidateLayout(n: number) {
		if (n === 1)
			return { container: `flex justify-center ${LG_CONTAINER}`, card: `w-64 p-4 text-sm lg:grow-0 ${LG_CARD}`, avatar: 'size-32' };
		if (n === 2)
			return { container: `flex justify-center gap-2 sm:gap-3 ${LG_CONTAINER}`, card: `w-[calc(50%-0.25rem)] max-w-56 p-3 text-xs sm:text-sm ${LG_CARD}`, avatar: 'size-20 lg:size-32' };
		if (n === 3)
			return { container: `mx-auto flex w-full max-w-md flex-col gap-2 ${LG_CONTAINER}`, card: `w-full p-3 text-xs sm:text-sm ${LG_CARD}`, avatar: 'size-20 lg:size-32' };
		return { container: `mx-auto flex w-full max-w-2xl flex-wrap justify-center gap-2 ${LG_CONTAINER}`, card: `basis-[calc(50%-0.25rem)] max-w-[calc(50%-0.25rem)] p-3 text-xs sm:text-sm ${LG_CARD}`, avatar: 'size-16 lg:size-32' };
	}
	// The region step a seat depends on — the escape hatch when a seat step is
	// reached while its geography is unset (possible via the GeoSelect bar).
	function regionStepFor(level: BallotLevel): number {
		const region: Region | null =
			level === 'mp' ? 'constituency' : level === 'mca' ? 'ward' : level === 'president' ? null : 'county';
		return region ? STEPS.findIndex((s) => s.kind === 'region' && s.region === region) : 0;
	}

	const REGION_TITLE: Record<Region, string> = {
		county: 'Choose Your County',
		constituency: 'Choose Your Constituency',
		ward: 'Choose Your Ward'
	};
	const regionOptions = $derived({
		county: data.countyOptions,
		constituency: data.constituencyOptions,
		ward: data.wardOptions
	});

	const seatNumber = $derived(step.kind === 'seat' ? SEAT_ORDER.indexOf(step.level) + 1 : 0);

	// "Use my location" on the county step: browser geolocation (explicit tap,
	// so the permission prompt is user-initiated) resolved to a county fully
	// offline via detectCountySlug — see locateCounty.ts for the privacy notes.
	let locating = $state(false);
	let locateError = $state<string | null>(null);
	function useMyLocation() {
		locateError = null;
		if (!navigator.geolocation) {
			locateError = 'Location is not supported by this browser — pick your county below.';
			return;
		}
		locating = true;
		navigator.geolocation.getCurrentPosition(
			async (pos) => {
				try {
					const { detectCountySlug } = await import('$lib/utils/locateCounty');
					const slug = await detectCountySlug(pos.coords.latitude, pos.coords.longitude);
					if (slug) await pickRegion('county', slug);
					else locateError = "Couldn't place you in a county — pick it below.";
				} catch {
					locateError = 'Something went wrong — pick your county below.';
				} finally {
					locating = false;
				}
			},
			(err) => {
				locating = false;
				locateError =
					err.code === err.PERMISSION_DENIED
						? 'Location permission denied — pick your county below.'
						: "Couldn't get your location — pick your county below.";
			},
			{ maximumAge: 300000, timeout: 10000 }
		);
	}
</script>

<svelte:head>
	<title>vote.ke — Cast your 2027 ballot</title>
	<meta
		name="description"
		content="Step into the voting booth: see every candidate you'd vote for in 2027 across all six elective levels, cast a simulated ballot, and share your result."
	/>
</svelte:head>

<!-- Full-viewport booth below the header: step area, controls, the
always-visible geo bar, then the disclaimer. The page never scrolls vertically.
The mobile search row is toggled (hidden by default) since the header's search
icon landed, so the header is 4rem tall at every breakpoint; opening the search
row pushes the booth down transiently, which is fine. -->
<form method="post" use:enhance class="contents">
<input type="hidden" name="county" value={county} />
<input type="hidden" name="constituency" value={constituency} />
<input type="hidden" name="ward" value={ward} />
<input type="hidden" name="selections" value={JSON.stringify(selections)} />
<div class="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
	<!-- Step area -->
	<div class="min-h-0 flex-1 overflow-hidden">
		{#key stepIndex}
			<div
				in:fly={{ x: 240, duration: 250 }}
				class="mx-auto flex h-full w-full max-w-7xl flex-col pt-4 sm:pt-8 lg:pt-12 px-4 sm:px-6"
			>
				{#if step.kind === 'seat'}
					{@const candidates = candidatesFor(step.level)}
					<h1 class="shrink-0 text-center text-2xl font-bold text-heading sm:text-3xl">
						{LEVEL_HEADING[step.level]}
					</h1>
					{#if levelRegion(step.level)}
						<p class="shrink-0 pt-1 sm:pt-2 lg:pt-4 text-center text-sm text-muted">{levelRegion(step.level)}</p>
					{/if}

					{#if candidates === null}
						<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
							<p class="text-sm text-muted">This seat needs your location first.</p>
							<button
								type="button"
								onclick={() => (stepIndex = regionStepFor(step.level))}
								class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95"
							>
								Choose it now
							</button>
						</div>
					{:else if candidates.length === 0}
						<div class="flex min-h-0 flex-1 items-center justify-center">
							<p class="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
								No candidates yet for this seat. Skip it and check back closer to the election.
							</p>
						</div>
					{:else}
						<!-- Count-adaptive tiles (see candidateLayout): hero card for 1,
						pair for 2, vertical list for 3, two-column grid for 4+. my-auto
						(not justify-center on the scroller) centers short content without
						clipping the top rows once the list overflows. -->
						{@const layout = candidateLayout(candidates.length)}
						<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
							<div class="my-auto py-3 {layout.container}">
								{#each candidates as candidate (candidate.candidateId)}
									<button
										type="button"
										onclick={() => pick(step.level, candidate.candidateId)}
										class="flex flex-col items-center gap-2 rounded-2xl border text-center transition {layout.card} {selections[step.level] === candidate.candidateId
											? 'border-primary bg-primary-soft'
											: 'border-border bg-surface hover:border-primary'}"
									>
										<Avatar name={candidate.name} initials={candidate.initials} photoUrl={candidate.photoUrl} sizeClass={layout.avatar} />
										<span class="min-w-0">
											<span class="flex items-center gap-1 font-semibold text-heading justify-center">
												{candidate.name}
												{#if candidate.verified}
													<svg viewBox="0 0 24 24" fill="currentColor" class="size-4 text-primary" aria-label="Verified">
														<title>An admin has manually confirmed this candidacy's IEBC certificate.</title>
														<path
															fill-rule="evenodd"
															d="M8.6 3.8a4.5 4.5 0 0 0-1.4 1 4.5 4.5 0 0 0-3.8 3.7 4.5 4.5 0 0 0 0 5 4.5 4.5 0 0 0 3.7 3.8 4.5 4.5 0 0 0 5 0 4.5 4.5 0 0 0 3.8-3.7 4.5 4.5 0 0 0 0-5 4.5 4.5 0 0 0-3.7-3.8 4.5 4.5 0 0 0-3.6-1Zm7 6.7a.75.75 0 1 0-1.2-.9l-3.2 4.3-1.7-1.7a.75.75 0 1 0-1 1l2.3 2.4a.75.75 0 0 0 1.1-.1l3.7-5Z"
															clip-rule="evenodd"
														/>
													</svg>
												{/if}
											</span>
											{#if candidate.party}<span class="block text-xs text-muted">{candidate.party}</span
												>{/if}
										</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{:else if step.kind === 'region'}
					<h1 class="shrink-0 text-center text-2xl font-bold text-heading sm:text-3xl">
						{REGION_TITLE[step.region]}
					</h1>
					{#if step.region !== 'county'}
						<p class="shrink-0 pt-1 text-center text-sm text-muted">
							in {step.region === 'constituency' ? data.countyName : data.constituencyName}
						</p>
					{:else}
						<!-- Offline county detection: coordinates are point-in-polygon
						tested against bundled boundaries, never sent or stored. -->
						<div class="shrink-0 pt-2 text-center">
							<button
								type="button"
								onclick={useMyLocation}
								disabled={locating}
								class="rounded-full border border-primary px-4 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-on-primary disabled:cursor-wait disabled:opacity-60"
							>
								{locating ? 'Locating…' : '📍 Use my location'}
							</button>
							{#if locateError}
								<p class="pt-1 text-xs text-muted">{locateError}</p>
							{/if}
						</div>
					{/if}

					<!-- Centered wrapping rows across max-w-7xl: more options per row the
					wider the screen, and partial rows stay centered. my-auto centers
					short lists without clipping the top once the list overflows. -->
					<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
						<div class="my-auto flex flex-wrap justify-center gap-2 py-3">
							{#each regionOptions[step.region] as option (option.slug)}
								<button
									type="button"
									onclick={() => pickRegion(step.region as Region, option.slug)}
									class="w-[calc(50%-0.25rem)] rounded-xl border px-2 py-2.5 text-sm font-medium transition sm:w-44 sm:px-3 {regionValue(
										step.region
									) === option.slug
										? 'border-primary bg-primary-soft text-heading'
										: 'border-border bg-surface text-heading hover:border-primary hover:bg-primary-soft'}"
								>
									{option.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}
					{#if step.kind === 'seat'}
						<!-- Aspirational write-in: search any profile on the platform and pick
						them for this seat, whether or not they're vying for it. Sitting at
						the bottom of the clipping booth, the list opens upward. -->
						<div class="mx-auto mt-3 w-full max-w-md shrink-0">
							{#if selections[step.level]?.startsWith('person:')}
								<div class="mb-2 flex items-center justify-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-sm text-on-primary">
									<span class="truncate font-semibold">✓ {writeInNames[selections[step.level] ?? ''] ?? 'Your pick'}</span>
									<span class="shrink-0 text-xs opacity-80">write-in</span>
									<button
										type="button"
										onclick={() => clearWriteIn(step.level as BallotLevel)}
										aria-label="Clear write-in pick"
										class="shrink-0 rounded-full px-1.5 font-semibold transition hover:bg-primary hover:text-on-primary"
									>
										✕
									</button>
								</div>
							{/if}
							<QuickSearch
								include={['Executive', 'Parliament', 'MCAs']}
								expand={false}
								direction="up"
								placeholder="Suggest someone else…"
								onPick={(item) => pickWriteIn(step.level as BallotLevel, item)}
							/>
						</div>
					{/if}
			</div>
		{/key}
	</div>

	<!-- Wizard controls: back + progress on the left, skip on the right. -->
	<div class="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between px-4 py-2 sm:px-6">
		<div class="flex items-center gap-3">
			{#if stepIndex > 0}
				<button
					type="button"
					onclick={goBack}
					class="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-primary hover:text-heading"
				>
					← Back
				</button>
			{/if}
			{#if step.kind === 'seat'}
				<p class="text-xs font-semibold tracking-wide text-primary uppercase">
					{seatNumber} of {SEAT_ORDER.length}
				</p>
			{/if}
		</div>
		{#if form?.message}
			<p class="text-sm text-red-500">{form.message}</p>
		{/if}
		{#if step.kind === 'seat' && candidatesFor(step.level) !== null}
			{#if step.level === 'mca'}
				<button
					type="submit"
					class="rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
				>
					See My Vote
				</button>
			{:else}
				<button
					type="button"
					onclick={() => skip(step.level as BallotLevel)}
					class="text-sm font-medium text-muted underline-offset-2 hover:text-heading hover:underline"
				>
					{selections[step.level] ? 'Clear selection' : 'Skip this seat'}
				</button>
			{/if}
		{/if}
	</div>

	<!-- The geo bar always hangs here, above the disclaimer: the correction tool
	that jumps the whole booth to any county/constituency/ward. -->
	<div class="shrink-0 border-t border-border px-4 py-2 sm:px-6">
		<div class="mx-auto max-w-7xl">
			<GeoSelect bind:county bind:constituency bind:ward onchange={onGeoChange} />
		</div>
	</div>

	<!-- Desktop keeps the disclaimer inside the no-scroll viewport; on mobile the
	booth needs every pixel, so it renders after the wrapper instead (below the
	fold — scroll to read it). -->
	<div class="hidden lg:block">
		<BallotDisclaimer />
	</div>
</div>
<div class="lg:hidden">
	<BallotDisclaimer />
</div>
</form>
