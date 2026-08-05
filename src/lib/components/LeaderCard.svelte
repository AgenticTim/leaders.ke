<script lang="ts">
	import { tooltip } from '$lib/effects';
	import { goto } from '$app/navigation';
	import Avatar from '$lib/components/Avatar.svelte';
	import VerifiedIcon from '$lib/components/svgs/VerifiedIcon.svelte';
	import { compareSelection, clearCompareSelection } from '$lib/stores/compare.svelte';
	import { plainText } from '$lib/utils/richtext';
	import { seatPath } from '$lib/utils/seat';

	type Props = {
		path: string;
		name: string;
		initials: string;
		photoUrl?: string | null;
		verified?: boolean;
		party?: string | null;
		partyPath?: string | null;
		positionTitle?: string;
		region?: string;
		status?: string;
		followers?: number;
		/** Only rendered by the large variant; the default card never shows a bio. */
		bio?: string | null;
		/** Large-only second seat line: a sitting leader's own 2027 candidacy,
		 * rendered under the held seat with its run badge. */
		campaignPositionTitle?: string | null;
		campaignRegion?: string | null;
		/** Badge for that second line: 'candidate' (admin-verified run) or 'aspirant'. */
		campaignStatus?: string | null;
		/** Header-card variant (e.g. /compare): card-height photo, bio in the right column. */
		large?: boolean;
	};

	let {
		path,
		name,
		initials,
		photoUrl = null,
		verified = false,
		party = null,
		partyPath = null,
		positionTitle,
		region,
		status,
		followers,
		bio,
		campaignPositionTitle = null,
		campaignRegion = null,
		campaignStatus = null,
		large = false
	}: Props = $props();

	const fmt = new Intl.NumberFormat('en-KE');

	// Compare affordance ([<>] top right): first click selects this leader as A;
	// with an A live, every other card offers B on hover, and clicking B lands on
	// /compare with both. Clicking A again unselects.
	const isSelected = $derived(compareSelection.path === path);
	const otherSelected = $derived(!!compareSelection.path && !isSelected);

	function onCompareClick() {
		if (isSelected) {
			clearCompareSelection();
		} else if (compareSelection.path) {
			const a = compareSelection.path;
			clearCompareSelection();
			goto(`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(path)}`);
		} else {
			compareSelection.path = path;
			compareSelection.name = name;
		}
	}
</script>

{#snippet seatLine(lineStatus: string | undefined, lineTitle: string | undefined, lineRegion: string | undefined)}
	{@const seat = seatPath(lineTitle, lineRegion)}
	<p class="mt-2 text-xs flex items-center gap-2">
		{#if lineStatus}
			<span class="rounded-full bg-surface-2 px-2 py-0.5 font-medium capitalize {lineStatus === 'current' ? 'text-primary' : ''}">
				{lineStatus}
			</span>
		{/if}
		{#if seat}
			<!-- z-10 keeps the seat link clickable above the card's stretched link. -->
			<a href={seat} class="relative z-10 hover:text-primary">
				{lineTitle}{lineTitle && lineRegion ? ', ' : ''}{lineRegion}
			</a>
		{:else}
			{lineTitle}{lineTitle && lineRegion ? ', ' : ''}{lineRegion}
		{/if}
	</p>
{/snippet}

<!-- The leader name uses a stretched link (after:absolute after:inset-0) so the
whole card is clickable, while the party name stays its own separate link on top. -->
<div class="group relative rounded-2xl border border-border bg-surface transition hover:border-primary hover:shadow-sm {large ? 'p-3' : 'p-2'}">
	{#if !large}
	<!-- Compare trigger: z-10 keeps it clickable above the card's stretched link. -->
	<button
		type="button"
		onclick={onCompareClick}
		use:tooltip={isSelected
			? 'Unselect from comparison'
			: otherSelected
				? `Compare with ${compareSelection.name}`
				: 'Select to compare'}
		aria-label={isSelected
			? 'Unselect from comparison'
			: otherSelected
				? `Compare with ${compareSelection.name}`
				: 'Select to compare'}
		aria-pressed={isSelected}
		class="absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full border font-mono text-xs font-bold transition
			{isSelected
			? 'border-primary bg-primary text-on-primary'
			: 'border-border bg-surface text-muted hover:border-primary hover:text-primary'}"
	>
		{#if isSelected}
			A
		{:else if otherSelected}
			<!-- With an A selected elsewhere, hovering this card offers the B slot. -->
			<span class="group-hover:hidden">&lt;&gt;</span>
			<span class="hidden group-hover:inline">B</span>
		{:else}
			&lt;&gt;
		{/if}
	</button>
	{/if}
	<div class="flex items-center {large ? 'flex-col lg:flex-row' : 'gap-2'}" >
		<!-- In the large variant the photo spans the card's height. -->
		<Avatar {name} {initials} {photoUrl} sizeClass={large ? 'size-50' : 'size-30'} textClass={large ? 'text-4xl' : 'text-xl'} />
		<div class="w-full min-w-0 {large? 'px-3 pt-4 lg:pt-0' : 'pr-0'}">
			<a href={path} class="flex items-center gap-1 font-semibold text-heading after:absolute after:inset-0 group-hover:text-primary">
				<span class="truncate">{name}</span>
				{#if verified}
					<VerifiedIcon class="size-4 shrink-0 text-primary" title="An admin has manually confirmed the facts on this seat/candidacy." />
				{/if}
			</a>
			{#if party}
				<p class="relative z-10 truncate {large ? 'my-1 text-sm' : 'text-xs'} text-muted">
					{#if partyPath}
						<a href={partyPath} class="hover:text-heading hover:underline">{party}</a>
					{:else}
						{party}
					{/if}
				</p>
			{/if}
			{#if positionTitle || region}
				{@render seatLine(status, positionTitle, region)}
			{/if}
			{#if large && (campaignPositionTitle || campaignRegion)}
				<!-- Second seat line (large only): the person's own 2027 candidacy. -->
				{@render seatLine(campaignStatus ?? 'aspirant', campaignPositionTitle ?? undefined, campaignRegion ?? undefined)}
			{/if}
			{#if followers !== undefined}
				<div class="mt-2 flex w-full items-center gap-2 text-xs text-muted justify-between">
					<span>{fmt.format(followers)} followers</span>
				</div>
			{/if}
			{#if large && bio}
				<!-- Large variant: the bio sits in the right column, under name/seat/party. -->
				{@const text = plainText(bio)}
				<p class="mt-2 text-xs leading-relaxed">{text.slice(0, 200)}{text.length > 200 ? '…' : ''}</p>
			{/if}
		</div>
	</div>
</div>
