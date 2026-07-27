<script lang="ts">
	import drives from '$lib/data/drives.json';
	import { counties } from '$lib/data/geo';

	const fmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	// County filter over the static listing — reuses the geo register's county names.
	let county = $state('');
	const filtered = $derived(county ? drives.filter((d) => d.county === county) : drives);
</script>

<svelte:head>
	<title>Voter registration drives — vote.ke</title>
	<meta name="description" content="Upcoming voter registration drives across Kenya's counties: where to go and what to carry." />
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
	<h1 class="text-3xl font-bold text-heading">Registration drives</h1>
	<p class="mt-2 text-base">
		Mobile registration desks near you. Carry your original national ID or passport — registration
		takes minutes and is always free.
	</p>
	<p class="mt-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm text-muted">
		Sample listings while drive schedules are being collected — always confirm with your county's
		IEBC office before travelling.
	</p>

	<select
		bind:value={county}
		aria-label="Filter by county"
		class="mt-6 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:outline-none sm:w-72"
	>
		<option value="">All counties</option>
		{#each counties as c (c.code)}
			<option value={c.name}>{c.name}</option>
		{/each}
	</select>

	<div class="mt-6 space-y-4">
		{#each filtered as drive (drive.county + drive.venue + drive.startDate)}
			<div class="rounded-2xl border border-border bg-surface p-5">
				<p class="text-xs font-semibold tracking-wide text-primary uppercase">{drive.county}</p>
				<h2 class="mt-1 text-lg font-semibold text-heading">{drive.venue}</h2>
				<p class="mt-1 text-sm">
					{fmt.format(new Date(drive.startDate))} – {fmt.format(new Date(drive.endDate))} · {drive.organizer}
				</p>
				<p class="mt-2 text-sm text-muted">{drive.details}</p>
			</div>
		{:else}
			<p class="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
				No drives listed for {county} yet. Your constituency's IEBC office registers voters every
				working day — find it via
				<a href="https://www.iebc.or.ke" class="underline hover:text-heading">iebc.or.ke</a>.
			</p>
		{/each}
	</div>
</section>
