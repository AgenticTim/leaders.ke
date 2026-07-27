<script lang="ts">
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

	function pickCounty(value: string) {
		county = value;
		constituency = '';
		ward = '';
		onchange?.();
	}

	function pickConstituency(value: string) {
		constituency = value;
		ward = '';
		onchange?.();
	}

	function pickWard(value: string) {
		ward = value;
		onchange?.();
	}
</script>

<!-- Mobile: label left of its select in a tight row (less vertical space);
sm and up: labels above, three columns. -->
<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-3">
	<label class="flex items-center gap-2 sm:block">
		<span class="w-24 shrink-0 text-xs font-medium text-muted sm:w-auto">County</span>
		<select
			value={county}
			onchange={(e) => pickCounty(e.currentTarget.value)}
			class="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none sm:mt-1 sm:py-2"
		>
			<option value="">Select county</option>
			{#each counties as c (c.code)}
				<option value={geoSlug(c.name)}>{c.name}</option>
			{/each}
		</select>
	</label>

	<label class="flex items-center gap-2 sm:block">
		<span class="w-24 shrink-0 text-xs font-medium text-muted sm:w-auto">Constituency</span>
		<select
			value={constituency}
			onchange={(e) => pickConstituency(e.currentTarget.value)}
			disabled={!selectedCounty}
			class="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none disabled:opacity-50 sm:mt-1 sm:py-2"
		>
			<option value="">Select constituency</option>
			{#each constituencies as c (c.code)}
				<option value={geoSlug(c.seatName)}>{c.name}</option>
			{/each}
		</select>
	</label>

	<label class="flex items-center gap-2 sm:block">
		<span class="w-24 shrink-0 text-xs font-medium text-muted sm:w-auto">Ward</span>
		<select
			value={ward}
			onchange={(e) => pickWard(e.currentTarget.value)}
			disabled={!selectedConstituency}
			class="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none disabled:opacity-50 sm:mt-1 sm:py-2"
		>
			<option value="">Select ward</option>
			{#each wards as w (w.seatName)}
				<option value={geoSlug(w.seatName)}>{w.name}</option>
			{/each}
		</select>
	</label>
</div>
