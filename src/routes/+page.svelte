<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import FollowCard from '$lib/components/FollowCard.svelte';
	import LeaderHoverCard from '$lib/components/LeaderHoverCard.svelte';
	import GeoSelect from '$lib/components/GeoSelect.svelte';
	import QuickSearch from '$lib/components/QuickSearch.svelte';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	let county = $state(data.countySlug);
	let constituency = $state(data.constituencySlug);
	let ward = $state(data.wardSlug);
	// Keep local values in sync with the URL (browser back/forward, direct links),
	// only when it actually specifies a region, same reasoning as the ballot
	// booth's own GeoSelect: an empty URL isn't a deliberate "clear my location".
	$effect(() => {
		if (data.countySlug) county = data.countySlug;
		if (data.constituencySlug) constituency = data.constituencySlug;
		if (data.wardSlug) ward = data.wardSlug;
	});

	// Carries whichever filters (tag/mention/geo/following) are currently active
	// into a new link, so toggling one never drops the others.
	function paramsWith(extra: Record<string, string>): URLSearchParams {
		const params = new URLSearchParams();
		if (data.activeTag) params.set('tag', data.activeTag);
		if (data.activeMention) params.set('mention', data.activeMention);
		if (county) params.set('county', county);
		if (constituency) params.set('constituency', constituency);
		if (ward) params.set('ward', ward);
		if (data.activeAuthor) params.set('author', String(data.activeAuthor));
		for (const [k, v] of Object.entries(extra)) {
			if (v) params.set(k, v);
			else params.delete(k);
		}
		return params;
	}

	// Toggling a tag/mention/author filter link: selecting the already-active one clears it.
	const tagHref = (tag: string) => `/?${paramsWith({ tag: data.activeTag === tag ? '' : tag })}`;
	const mentionHref = (slug: string) => `/?${paramsWith({ mention: data.activeMention === slug ? '' : slug })}`;
	const authorHref = (personId: number) => `/?${paramsWith({ author: data.activeAuthor === personId ? '' : String(personId) })}`;

	function onGeoChange() {
		goto(`/?${paramsWith({})}`, { keepFocus: true, noScroll: true });
	}

	// Sidebar mentions ordering: by mention count (default, most first) or by
	// name, either direction. A pure client-side reorder of the loaded list;
	// clicking the active sort flips its direction.
	let mentionSort = $state<'count' | 'name'>('count');
	let mentionSortDesc = $state(true);
	const sortedMentions = $derived.by(() => {
		const list = [...data.mentions].sort((a, b) =>
			mentionSort === 'name' ? a.name.localeCompare(b.name) : a.n - b.n
		);
		if (mentionSortDesc) list.reverse();
		return list;
	});
	function toggleMentionSort(kind: 'count' | 'name') {
		if (mentionSort === kind) {
			mentionSortDesc = !mentionSortDesc;
		} else {
			mentionSort = kind;
			// Fresh picks start at their natural reading order: names A to Z,
			// counts most-mentioned first.
			mentionSortDesc = kind === 'count';
		}
	}
</script>

<svelte:head>
	<title>vote.ke · Kenya's leaders, tracked daily</title>
	<meta
		name="description"
		content="Daily news and press mentions for every verified Kenyan leader and 2027 candidate. Filter by county, constituency, ward, or topic, then practise your ballot."
	/>
</svelte:head>

<div class="border-b border-border bg-surface-2">
	<div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
		<h1 class="text-4xl font-bold tracking-tight text-heading">What Kenya's leaders are doing</h1>
		<p class="mt-3 text-lg leading-relaxed text-muted">
			Updates straight from leaders and candidates, plus their mentions in the wider press, fresh every day.
		</p>
	</div>
</div>

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
	<!-- Ballot funnel, mobile placement: the sidebar stacks below the whole feed on
	small screens, which would bury the booth's card several scrolls down. -->
	<a
		href="/ballot"
		class="mb-8 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 p-4 transition hover:border-primary lg:hidden"
	>
		<span>
			<span class="block font-semibold text-heading">Practise your 2027 ballot</span>
			<span class="mt-0.5 block text-sm text-muted">See your candidates for all six seats and cast a simulated vote.</span>
		</span>
		<span class="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary">Start</span>
	</a>

	<div class="grid gap-10 lg:grid-cols-10">
		<div class="lg:col-span-7">
			{#if data.activeTag || data.activeMention || data.activeAuthor}
				<div class="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted">
					<span>Filtering by</span>
					{#if data.activeAuthor}
						<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">
							{data.followedAuthors.find((a) => a.personId === data.activeAuthor)?.name ?? 'Followed leader'}
						</span>
					{/if}
					{#if data.activeTag}
						<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">{data.activeTag}</span>
					{/if}
					{#if data.activeMention}
						<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">
							@{data.mentions.find((m) => m.slug === data.activeMention)?.name ?? data.activeMention}
						</span>
					{/if}
					<a href="/" class="font-semibold text-primary hover:underline">Clear</a>
				</div>
			{/if}

			<div class="divide-y divide-border">
				{#each data.articles as article (article.kind + article.id)}
					<article class="py-8 first:pt-0">
						<div class="flex items-center gap-2.5">
							{#if article.authorPath !== '#'}
								<a href={article.authorPath} class="shrink-0">
									<Avatar name={article.authorName} initials={article.authorInitials} photoUrl={article.authorPhotoUrl} sizeClass="size-9" textClass="text-sm" />
								</a>
							{:else}
								<Avatar name={article.authorName} initials={article.authorInitials} photoUrl={article.authorPhotoUrl} sizeClass="size-9" textClass="text-sm" />
							{/if}
							<div class="text-sm">
								{#if article.authorPath !== '#'}
									<LeaderHoverCard path={article.authorPath}>
										<a href={article.authorPath} class="font-semibold text-heading hover:text-primary">{article.authorName}</a>
									</LeaderHoverCard>
								{:else}
									<span class="font-semibold text-heading">{article.authorName}</span>
								{/if}
								<span class="text-muted"> · {dateFmt.format(new Date(article.createdAt))}</span>
								{#if article.kind === 'mention'}
									<span class="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">Mention</span>
								{/if}
							</div>
						</div>

						<h2 class="mt-4 text-2xl font-bold text-heading">
							{#if article.external}
								<a href={article.href} target="_blank" rel="noopener" class="hover:text-primary">{article.title} ↗</a>
							{:else}
								<a href={article.href} class="hover:text-primary">{article.title}</a>
							{/if}
						</h2>
						<p class="mt-3 leading-relaxed text-muted">{article.excerpt}</p>

						{#if article.mentions.length}
							<p class="mt-3 text-sm text-muted">
								Mentions
								{#each article.mentions as m, i (m.slug)}{i > 0 ? ', ' : ' '}<LeaderHoverCard path={`/${m.slug}`}><a href={mentionHref(m.slug)} class="font-medium text-primary hover:underline">@{m.name}</a></LeaderHoverCard>{/each}
							</p>
						{/if}

						<div class="mt-4 flex flex-wrap items-center gap-3">
							{#if article.tags.length}
								<div class="flex flex-wrap gap-1.5">
									{#each article.tags as tag (tag)}
										<a href={tagHref(tag)} class="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted hover:border-primary hover:text-primary">{tag}</a>
									{/each}
								</div>
							{/if}
							{#if article.authorUserId}
								<!-- Account-less follow funnel: follow the author from their news. -->
								<div class="w-44">
									<FollowCard candidateName={article.authorName} subjectUserId={article.authorUserId} />
								</div>
							{/if}
							{#if article.external}
								<a href={article.href} target="_blank" rel="noopener" class="ml-auto text-sm font-semibold text-primary hover:underline">Read on source site ↗</a>
							{:else}
								<a href={article.href} class="ml-auto text-sm font-semibold text-primary hover:underline">Read more →</a>
							{/if}
						</div>
					</article>
				{:else}
					<p class="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
						{data.activeTag || data.activeMention || data.activeAuthor
							? 'No articles match this filter.'
							: 'No news yet. Check back once campaigns start posting.'}
					</p>
				{/each}
			</div>

			<Pagination
				page={data.page}
				{totalPages}
				total={data.total}
				itemLabel="articles"
				href={(p) => {
					const params = paramsWith({});
					params.set('page', String(p));
					return `/?${params}`;
				}}
			/>
		</div>

		<!-- rhs: the ballot funnel, then filter by who you follow, location, topic
		tag, or a mentioned leader -->
		<div class="space-y-6 lg:col-span-3">
			<div class="hidden rounded-2xl border border-border bg-surface-2 p-4 lg:block">
				<p class="text-xs font-semibold tracking-wide text-muted uppercase">2027 ballot</p>
				<p class="mt-2 text-sm leading-relaxed text-muted">
					Step into the booth: see your candidates for all six seats and cast a simulated vote.
				</p>
				<a
					href="/ballot"
					class="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
				>
					Practise your vote
				</a>
			</div>
			{#if data.followedAuthors.length > 0}
				<div>
					<p class="text-xs font-semibold tracking-wide text-muted uppercase">Leaders you follow</p>
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each data.followedAuthors as a (a.personId)}
							<a
								href={authorHref(a.personId)}
								class="rounded-full border px-2.5 py-1 text-xs font-medium transition {data.activeAuthor === a.personId
									? 'border-primary bg-primary-soft text-on-primary'
									: 'border-border bg-surface-2 text-muted hover:border-primary hover:text-primary'}"
							>
								{a.name}
							</a>
						{/each}
					</div>
				</div>
			{/if}
			<div>
				<p class="text-xs font-semibold tracking-wide text-muted uppercase">Local news</p>
				<div class="mt-2">
					<GeoSelect bind:county bind:constituency bind:ward onchange={onGeoChange} />
				</div>
			</div>
			<div>
				<p class="text-xs font-semibold tracking-wide text-muted uppercase">Tags</p>
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#each data.tags as t (t.tag)}
						<a
							href={tagHref(t.tag)}
							class="rounded-full border px-2.5 py-1 text-xs font-medium transition {data.activeTag === t.tag
								? 'border-primary bg-primary-soft text-on-primary'
								: 'border-border bg-surface-2 text-muted hover:border-primary hover:text-primary'}"
						>
							{t.tag} <span class="opacity-70">({t.n})</span>
						</a>
					{:else}
						<p class="text-sm text-muted">No tags yet.</p>
					{/each}
				</div>
			</div>
			<div>
				<p class="text-xs font-semibold tracking-wide text-muted uppercase">Find a profile</p>
				<div class="mt-2">
					<QuickSearch
						include={['Executive', 'Parliament', 'MCAs']}
						expand={false}
						placeholder="Filter news by a leader or candidate…"
						onPick={(item) => goto(mentionHref(item.path.slice(1)))}
					/>
				</div>
			</div>
			<div>
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold tracking-wide text-muted uppercase">Mentions</p>
					<!-- Sort toggles: the active one shows its direction and flips on click. -->
					<div class="flex items-center gap-1">
						<button
							type="button"
							onclick={() => toggleMentionSort('name')}
							aria-label="Sort mentions by name"
							aria-pressed={mentionSort === 'name'}
							class="rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition {mentionSort === 'name'
								? 'border-primary text-primary'
								: 'border-border text-muted hover:border-primary hover:text-primary'}"
						>
							{mentionSort === 'name' && mentionSortDesc ? 'Z-A' : 'A-Z'}
						</button>
						<button
							type="button"
							onclick={() => toggleMentionSort('count')}
							aria-label="Sort mentions by count"
							aria-pressed={mentionSort === 'count'}
							class="rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition {mentionSort === 'count'
								? 'border-primary text-primary'
								: 'border-border text-muted hover:border-primary hover:text-primary'}"
						>
							# {mentionSort === 'count' && !mentionSortDesc ? '↑' : '↓'}
						</button>
					</div>
				</div>
				<div class="mt-2 flex flex-col gap-1.5">
					{#each sortedMentions as m (m.slug)}
						<a
							href={mentionHref(m.slug)}
							class="flex items-center justify-between rounded-lg px-2 py-1 text-sm transition {data.activeMention === m.slug
								? 'bg-primary-soft font-semibold text-on-primary'
								: 'text-heading hover:bg-surface-2'}"
						>
							<span>@{m.name}</span>
							<span class="text-xs opacity-70">{m.n}</span>
						</a>
					{:else}
						<p class="text-sm text-muted">No mentions yet.</p>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
