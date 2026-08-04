<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { counties, geoSlug } from '$lib/data/geo';

	// Cascading county -> constituency -> ward picker over the IEBC geo register.
	// Shared by the homepage ballot search and the ballot top bar. Values are slugs
	// (geoSlug), matching the URL query params used across the app.
	let {
		county = $bindable(''),
		constituency = $bindable(''),
		ward = $bindable(''),
		onchange
	}: {
		county?: string;
		constituency?: string;
		ward?: string;
		onchange?: () => void;
	} = $props();

	const selectedCounty = $derived(counties.find((c) => geoSlug(c.name) === county));
	const constituencies = $derived(selectedCounty?.constituencies ?? []);
	const selectedConstituency = $derived(
		constituencies.find((c) => geoSlug(c.seatName) === constituency)
	);
	const wards = $derived(selectedConstituency?.wards ?? []);

	// The last geo picked anywhere in the app, remembered across pages/visits so
	// every GeoSelect instance prefills with it. A page that already knows a value
	// (a saved profile location, a URL param) always wins over the remembered one.
	// This is only a fallback for whichever fields arrive empty.
	const STORAGE_KEY = 'geoSelection';

	onMount(() => {
		if (!browser || county || constituency || ward) return;
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
			if (!saved?.county) return;
			county = saved.county;
			if (saved.constituency) constituency = saved.constituency;
			if (saved.ward) ward = saved.ward;
			// Restoring silently would leave a page whose own data (candidate lists,
			// unlocked seats…) was fetched for "no region" out of sync with what's now
			// showing selected, same follow-up a user's own pick would trigger.
			onchange?.();
		} catch {
			// Corrupt/blocked storage, just start blank.
		}
	});

	function remember() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ county, constituency, ward }));
		} catch {
			// Storage full/blocked (private browsing). Nothing to remember this visit.
		}
	}

	function pickCounty(value: string) {
		county = value;
		constituency = '';
		ward = '';
		remember();
		onchange?.();
	}

	function pickConstituency(value: string) {
		constituency = value;
		ward = '';
		remember();
		onchange?.();
	}

	function pickWard(value: string) {
		ward = value;
		remember();
		onchange?.();
	}
</script>

<!-- One tight row at every size, no labels (the placeholder option names each
field; aria-label keeps it accessible), minimal vertical footprint. -->
<div class="grid grid-cols-3">
	<select
		value={county}
		onchange={(e) => pickCounty(e.currentTarget.value)}
		aria-label="County"
		class="w-full min-w-0 rounded-l-lg border border-border bg-surface px-2 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none sm:px-3 sm:py-2"
	>
		<option value="">County</option>
		{#each counties as c (c.code)}
			<option value={geoSlug(c.name)}>{c.name}</option>
		{/each}
	</select>

	<select
		value={constituency}
		onchange={(e) => pickConstituency(e.currentTarget.value)}
		disabled={!selectedCounty}
		aria-label="Constituency"
		class="w-full min-w-0 border-l-0 border-r-0 border-border bg-surface px-2 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none disabled:opacity-50 sm:px-3 sm:py-2"
	>
		<option value="">Constituency</option>
		{#each constituencies as c (c.code)}
			<option value={geoSlug(c.seatName)}>{c.name}</option>
		{/each}
	</select>

	<select
		value={ward}
		onchange={(e) => pickWard(e.currentTarget.value)}
		disabled={!selectedConstituency}
		aria-label="Ward"
		class="w-full min-w-0 rounded-r-lg border border-border bg-surface px-2 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none disabled:opacity-50 sm:px-3 sm:py-2"
	>
		<option value="">Ward</option>
		{#each wards as w (w.seatName)}
			<option value={geoSlug(w.seatName)}>{w.name}</option>
		{/each}
	</select>
</div>
