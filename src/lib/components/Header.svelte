<script lang="ts">
	import type { User } from 'better-auth';
	import { page } from '$app/state';
	import { computeDashboardModes, type DashboardModesInput } from '$lib/utils/dashboardModes';
	import AskSparkle from './AskSparkle.svelte';
	import NotificationsPanel from './NotificationsPanel.svelte';
	import QuickSearch from './QuickSearch.svelte';
	import CloseIcon from './svgs/CloseIcon.svelte';
	import MenuIcon from './svgs/MenuIcon.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	// user is null when signed out; drives the Log in / Log out switch.
	let { user = null }: { user?: User | null } = $props();

	// While the quick search is expanded it covers the nav links' space.
	let searchOpen = $state(false);
	// Mobile-only: whether the full-width search row under the bar is showing.
	let mobileSearchOpen = $state(false);

	// Under /dashboard the layout's own load already computed myCampaigns/pendingClaims/
	// isAdmin (it's mid-request there anyway) — page.data has them for free. Everywhere
	// else (public pages, /pricing, a leader's profile…) they're absent, since running
	// that query on every page view for every signed-in visitor would tax the site's
	// highest-traffic pages just to feed a dropdown most visits never open. Lazy-fetched
	// once per page-load session instead, cached here so reopening the dropdown (or
	// navigating client-side, since Header stays mounted) never re-fetches.
	let fetchedSwitcherData = $state<DashboardModesInput | null>(null);
	let fetchingSwitcher = false;
	const hasEagerSwitcherData = $derived(page.data.myCampaigns !== undefined);
	const modes = $derived(computeDashboardModes(page.url.pathname, hasEagerSwitcherData ? page.data : (fetchedSwitcherData ?? page.data)));

	async function ensureSwitcherData() {
		if (hasEagerSwitcherData || fetchedSwitcherData || fetchingSwitcher || !user) return;
		fetchingSwitcher = true;
		try {
			const res = await fetch('/api/switcher');
			if (res.ok) fetchedSwitcherData = await res.json();
		} finally {
			fetchingSwitcher = false;
		}
	}

	// The <details> dropdown doesn't auto-close on navigation — close it
	// explicitly when a mode is picked, and on any click outside it. Desktop-only
	// (md+): below md this whole switcher is hidden, its job done instead by the
	// hamburger panel's own For Leaders / For Citizens tiles (see menuOpen below).
	let switcherOpen = $state(false);
	let switcherEl: HTMLDetailsElement | undefined = $state();
	$effect(() => {
		if (!switcherOpen) return;
		ensureSwitcherData();
		const onClick = (e: MouseEvent) => {
			if (switcherEl && !switcherEl.contains(e.target as Node)) switcherOpen = false;
		};
		document.addEventListener('click', onClick);
		return () => document.removeEventListener('click', onClick);
	});

	// Nav is voters-first: leader/SaaS pages (features, pricing) live under
	// /for-leaders and the footer instead of the top bar.
	const links = [
		{ href: '/presidents', label: 'Leaders' },
		{ href: '/rank/presidents', label: 'Ranks' },
		{ href: '/compare', label: 'Compare' },
		{ href: '/education', label: 'Learn' },
		{ href: '/news', label: 'News' },
		{ href: '/for-leaders', label: 'For Leaders' }
	];

	// Mobile nav: the desktop links (and the desktop switcher/bell) are hidden below
	// md, so a hamburger opens a stacked panel with everything folded in instead —
	// a flat "For Leaders" / "For Citizens" grid, no nested dropdowns.
	let menuOpen = $state(false);
	$effect(() => {
		if (menuOpen) ensureSwitcherData();
	});

	// Same source the desktop switcher's `modes` derives from, kept raw here (name +
	// basePath, not the "Manage: X" label) for the hamburger's leader shortcut tiles.
	const switcherData = $derived(hasEagerSwitcherData ? page.data : (fetchedSwitcherData ?? page.data));
	const myCampaigns = $derived((switcherData.myCampaigns ?? []) as { leaderId: number; name: string; basePath: string }[]);
	const isAdminUser = $derived(!!switcherData.isAdmin);
	// Whether this account has anything to run, vs. a pure citizen who'd only ever
	// see the Features/Pricing/Join funnel under For Leaders.
	const isLeaderAccount = $derived(myCampaigns.length > 0 || isAdminUser);

	const tileClass = 'block py-2.5 text-center text-sm font-medium text-text transition hover:bg-surface-2 hover:text-heading';
	// Wraps a row of tiles: one shared dim border round the outside, divided
	// internally by hairlines instead of every tile drawing (and doubling up) its own.
	const tileGridClass = 'grid overflow-hidden rounded-3xl border border-border/60 divide-x divide-y divide-border/60';
</script>

<header class="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur">
	<div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
		<a href="/" class="flex items-center gap-2 font-semibold text-heading text-2xl">
			<span>vote<span class="text-primary">.ke</span></span>
		</a>

		<div class="mx-3 flex min-w-0 flex-1 items-center justify-end gap-1 md:justify-center">
			{#if !searchOpen}
				<nav class="hidden items-center gap-1 md:flex">
					{#each links as link (link.href)}
						<a
							href={link.href}
							class="rounded-md px-3 py-2 text-sm font-medium text-text transition hover:bg-surface-2 hover:text-heading"
						>
							{link.label}
						</a>
					{/each}
				</nav>
			{/if}
			<!-- Only stretch while the search is open (it then covers the nav's space, capped and
			     centered); closed, the span shrink-wraps so nav + search center as one group. -->
			<span class="hidden lg:flex {searchOpen ? 'w-full justify-center' : ''}">
				<QuickSearch bind:open={searchOpen} hotkey />
			</span>
		</div>

		<div class="flex items-center gap-2">
			<!-- Platform-wide AI chat: available on every route, so it lives here
			beside the theme toggle rather than on any one page. -->
			<AskSparkle />
			<ThemeToggle />
			<!-- Mobile search toggle: the full-width search row below only renders
			while this is on, so the bar doesn't permanently tax mobile height. -->
			<button
				type="button"
				onclick={() => (mobileSearchOpen = !mobileSearchOpen)}
				aria-label="Toggle search"
				aria-expanded={mobileSearchOpen}
				class="grid size-9 place-items-center rounded-full border border-border bg-surface-2 text-heading transition hover:bg-surface-3 focus:ring-0 focus:ring-ring focus:outline-none lg:hidden"
			>
				{#if mobileSearchOpen}
					<CloseIcon class="size-4" />
				{:else}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-4">
						<path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.34-4.34M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
					</svg>
				{/if}
			</button>
			{#if user}
				<div class="hidden items-center gap-2 md:flex">
					<NotificationsPanel />
					<!-- Account switcher: always offers Log out, even for a pure citizen with
					no other context to switch into (modes.length === 1) — only the extra
					mode entries (campaign you run/manage, a pending claim, Platform admin)
					are conditional on having more than one. Below md this is hidden — the
					hamburger panel's own tiles do this job on mobile instead. -->
					<details class="group relative w-fit" bind:open={switcherOpen} bind:this={switcherEl}>
						<summary
							aria-label="Account menu"
							class="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-heading transition hover:bg-surface-2"
						>
							{#if modes.length > 1}
								<span>{modes.find((m) => m.current)?.label ?? modes[0].label}</span>
							{:else}
								<span
									class="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-on-primary uppercase"
								>
									{user.name.trim().charAt(0)}
								</span>
								<span class="max-w-32 truncate">{user.name}</span>
							{/if}
							<span class="text-muted transition group-open:rotate-180 leading-none h-2">^</span>
						</summary>
						<div class="absolute right-0 z-10 mt-2 min-w-52 rounded-2xl border border-border bg-surface p-1.5 shadow-lg">
							{#each modes as m (m.key)}
								<a
									href={m.href}
									onclick={() => (switcherOpen = false)}
									class="block truncate rounded-xl px-3 py-1.5 text-sm transition hover:bg-primary hover:text-on-primary {m.current
										? 'bg-surface-2 font-semibold text-heading'
										: 'text-muted'}"
								>
									{m.label}
								</a>
							{/each}
							<a
								href="/logout"
								data-sveltekit-preload-data="off"
								data-sveltekit-reload
								class="block truncate rounded-xl px-3 py-1.5 text-sm text-muted transition hover:bg-primary hover:text-on-primary"
							>
								Log out
							</a>
						</div>
					</details>
				</div>
			{:else}
				<a
					href="/login"
					class="hidden rounded-md px-3 py-2 text-sm font-medium text-text transition hover:text-heading sm:block"
				>
					Log in
				</a>
				<a
					href="/for-leaders"
					class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 focus:ring-0 focus:ring-ring focus:outline-none"
				>
					Join
				</a>
			{/if}
			<!-- Hamburger: mobile-only trigger for the nav panel -->
			<button
				type="button"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label="Toggle menu"
				aria-expanded={menuOpen}
				class="grid size-9 place-items-center rounded-md text-heading transition hover:bg-surface-2 md:hidden"
			>
				{#if menuOpen}
					<CloseIcon class="size-5" />
				{:else}
					<MenuIcon class="size-5" />
				{/if}
			</button>
		</div>

	</div>

	<!-- Mobile nav panel: a flat "For Leaders" / "For Citizens" grid, no nested
	dropdowns — an account that manages a campaign or is a platform admin gets its
	shortcuts (campaign names, Platform Admin, Log out) up top; everyone else gets
	the Features/Pricing/Join funnel at the bottom instead. -->
	{#if menuOpen}
		<nav class="border-t border-border bg-surface lg:hidden">
			<div class="mx-auto max-w-7xl space-y-4 px-2 py-3 sm:px-4">
				{#if user && isLeaderAccount}
					<div class="{tileGridClass}">
						{#each myCampaigns as c (c.basePath)}
							<a href="{c.basePath}/profile" onclick={() => (menuOpen = false)} class={tileClass}>{c.name}</a>
						{/each}
						{#if isAdminUser}
							<a href="/dashboard/admin/profiles" onclick={() => (menuOpen = false)} class={tileClass}>Platform Admin</a>
						{/if}
					</div>
				{/if}

				<div>
					{#if user}
						<p class="mb-2 text-center text-xs font-semibold tracking-wide text-muted uppercase">For Citizens</p>
					{/if}
					<div class="{tileGridClass} grid-cols-3">
						{#if user}
							<a href="/dashboard/my-vote" onclick={() => (menuOpen = false)} class={tileClass}>My Vote</a>
							<a href="/dashboard/notifications" onclick={() => (menuOpen = false)} class={tileClass}>Notifications</a>
							<a href="/dashboard/account" onclick={() => (menuOpen = false)} class={tileClass}>Account</a>
						{/if}
						<a href="/presidents" onclick={() => (menuOpen = false)} class={tileClass}>Leaders</a>
						<a href="/rank/presidents" onclick={() => (menuOpen = false)} class={tileClass}>Ranks</a>
						<a href="/compare" onclick={() => (menuOpen = false)} class={tileClass}>Compare</a>
						<a href="/news" onclick={() => (menuOpen = false)} class={tileClass}>News</a>
						<a href="/education" onclick={() => (menuOpen = false)} class={tileClass}>Learn</a>
						<a href="/drives" onclick={() => (menuOpen = false)} class={tileClass}>Reg. Drives</a>
						<a href="/dates" onclick={() => (menuOpen = false)} class={tileClass}>Key Dates</a>
						<a href="/verify-registration" onclick={() => (menuOpen = false)} class={tileClass}>Verify</a>
						{#if user}
						<a href="/logout" data-sveltekit-preload-data="off" data-sveltekit-reload class={tileClass}>Log out</a>
						{:else}
						<a href="/login" data-sveltekit-preload-data="off" data-sveltekit-reload class={tileClass}>Login</a>
						{/if}

					</div>
				</div>

				{#if !isLeaderAccount}
					<div>
						<p class="mb-2 text-center text-xs font-semibold tracking-wide text-muted uppercase">For Leaders</p>
						<div class="{tileGridClass} grid-cols-3">
							<a href="/features" onclick={() => (menuOpen = false)} class={tileClass}>Features</a>
							<a href="/pricing" onclick={() => (menuOpen = false)} class={tileClass}>Pricing</a>
							<a href="/onboard/profile" onclick={() => (menuOpen = false)} class={tileClass}>Onboard</a>
						</div>
					</div>
				{/if}
			</div>
		</nav>
	{/if}
	<!-- Mobile: the search row appears only while the bar's search icon is on —
	a permanent row taxed every mobile viewport (especially the booth).
	expand={false} keeps the input w-full instead of shrink-until-focused. -->
	{#if mobileSearchOpen}
		<div class="block px-4 pb-3 lg:hidden">
			<QuickSearch bind:open={searchOpen} expand={false} />
		</div>
	{/if}
</header>
