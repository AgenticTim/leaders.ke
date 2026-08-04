<script lang="ts">
	import { tooltip } from '$lib/effects';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/stores/toast';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
	const dateOnlyFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	// Grant-credits modal: which profile it's open for (null = closed).
	let grantingFor = $state<{ profileId: number; profileName: string } | null>(null);
	// bind:value on a type="number" input yields a real number (or '' when
	// empty), never a string with a .trim() method, typed accordingly.
	let grantAmount = $state<number | ''>('');
	let granting = $state(false);

	// Inline package switcher: which profile's select is mid-submit (null = none).
	const TIERS = ['kickstart', 'mobilize', 'dominate'] as const;
	let switchingId = $state<number | null>(null);

	// Click a row to expand its review history (claims on this profile + verification
	// requests on its runs), fetched on demand and cached, so a full page of rows
	// doesn't pay for all their histories up front.
	type Extras = {
		applicantName: string | null;
		claimHistory: { id: number; claimantName: string; email: string | null; phone: string | null; role: string | null; nationalId: string | null; requestedAt: string; outcome: string | null; deleted: boolean; reviewedAt: string | null; reviewerName: string | null; notes: string | null }[];
		applications: { id: number; candidateName: string; role: string | null; nationalId: string | null; requestedAt: string; outcome: string | null; reviewedAt: string | null; reviewerName: string | null; notes: string | null }[];
	};
	let expandedId = $state<number | null>(null);
	let loadingId = $state<number | null>(null);
	let extrasCache = $state<Record<number, Extras>>({});

	async function toggleExpand(profileId: number) {
		if (expandedId === profileId) {
			expandedId = null;
			return;
		}
		expandedId = profileId;
		if (extrasCache[profileId]) return;
		loadingId = profileId;
		try {
			const res = await fetch(`/dashboard/admin/profiles/${profileId}`);
			if (res.ok) extrasCache[profileId] = await res.json();
		} finally {
			loadingId = null;
		}
	}

	// Keep the current search + sort in the pager links.
	function pagerHref(p: number) {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (data.sort !== 'recent') params.set('sort', data.sort);
		params.set('dir', data.dir);
		params.set('page', String(p));
		return `?${params}`;
	}

	// Clicking a column header sorts by it. Toggling asc/desc if it's already the
	// active column, else ascending. Search is preserved; paging resets to page 1.
	function sortHref(col: string) {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		params.set('sort', col);
		params.set('dir', data.sort === col && data.dir === 'asc' ? 'desc' : 'asc');
		return `?${params}`;
	}
	const sortArrow = (col: string) => (data.sort === col ? (data.dir === 'asc' ? '↑' : '↓') : '');

	// Hover explanations for the derived pills (they aren't stored, see profiles.ts).
	const SOURCE_HELP = 'How the profile came to exist: has a claim → claimed; else has an active manager → applied; else → seeded.';
	const VERIFIED_HELP =
		'Review-workflow state, keyed off source: seeded → -; claimed → latest claim outcome (pending/approved/rejected); applied → run verified → approved, else latest verification request outcome; soft-deleted person → deleted.';

	// Colour the source + verified pills.
	const sourceClass: Record<string, string> = {
		seeded: 'border border-border text-muted',
		applied: 'bg-primary-soft text-on-primary',
		claimed: 'bg-surface-2 text-heading'
	};
	function verifiedClass(v: string | null) {
		if (v === 'approved') return 'bg-primary-soft text-on-primary';
		if (v === 'rejected' || v === 'deleted') return 'bg-surface-2 text-muted';
		if (v === 'pending') return 'border border-primary text-primary';
		return 'border border-border text-muted';
	}
</script>

<svelte:head><title>Profiles · Admin</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">Profiles</h1>
	<p class="mt-1 text-sm text-muted">
		Every leader profile. "Admin" opens the leader's own dashboard, where you can edit, review and decide.
	</p>

	<!-- Server-side search across all pages. -->
	<form method="get" class="mt-6 flex items-center gap-2">
		<input
			type="search"
			name="q"
			value={data.q}
			placeholder="Search name, URL, seat or manager…"
			class="w-full max-w-xs rounded-full border border-border bg-surface px-4 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
		/>
		<button type="submit" class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Search</button>
		{#if data.q}<a href="?" class="text-sm text-muted hover:text-heading">Clear</a>{/if}
	</form>

	{#if data.profiles.length > 0}
		<div class="mt-4 overflow-x-auto rounded-2xl border border-border">
			<table class="w-full min-w-240 border-collapse text-left whitespace-nowrap">
				<thead>
					<tr class="bg-surface-2">
						<th use:tooltip={'The account controlling the profile: the claimant or the applicant (blank for a seeded profile with neither).'} class="cursor-help px-4 py-3 text-sm font-semibold text-heading">Manager</th>
						{#snippet sortable(col: string, label: string)}
							<th class="px-4 py-3 text-sm font-semibold text-heading">
								<a href={sortHref(col)} class="inline-flex items-center gap-1 hover:text-primary" class:text-primary={data.sort === col}>
									{label}<span class="text-xs">{sortArrow(col)}</span>
								</a>
							</th>
						{/snippet}
						{@render sortable('name', 'Profile')}
						{@render sortable('position', 'Position')}
						{@render sortable('region', 'Region')}
						{@render sortable('status', 'Status')}
						{@render sortable('source', 'Source')}
						{@render sortable('verified', 'Verified')}
						<th class="px-4 py-3 text-sm font-semibold text-heading">Subscription</th>
						<th class="px-4 py-3 text-sm font-semibold text-heading">Credits</th>
						<th class="px-4 py-3 text-sm font-semibold text-heading">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.profiles as p (p.profileId)}
						<tr class="cursor-pointer border-t border-border transition hover:bg-surface-2" onclick={() => toggleExpand(p.profileId)}>
							<td class="px-4 py-3 text-sm text-muted">
								{#if p.managerName}
									<div class="flex items-center justify-between gap-2">
										<span class="font-medium">{p.managerName}</span>
										<span class="font-medium">{p.managerId}</span>
									</div>
								{:else}
									-
								{/if}
							</td>
							<td class="px-4 py-3 text-sm text-heading">
								<div class="flex items-center justify-between gap-2">
									<span class="flex items-center gap-1.5">
										<span class="text-muted transition {expandedId === p.profileId ? 'rotate-90' : ''}">›</span>
										<span class="font-medium">{p.profileName}</span>
									</span>
									<span class="font-medium text-muted">{p.profileId}</span>
								</div>
							</td>
							<td class="px-4 py-3 text-sm text-muted">{p.positionTitle}</td>
							<td class="px-4 py-3 text-sm text-muted" onclick={(e) => e.stopPropagation()}>
								{#if p.regionPath}
									<a href={p.regionPath} target="_blank" rel="noopener" class="hover:text-primary hover:underline">{p.region}</a>
								{:else}
									{p.region}
								{/if}
							</td>
							<td class="px-4 py-3 text-sm capitalize text-muted">{p.status}</td>
							<td class="px-4 py-3 text-sm">
								<span use:tooltip={SOURCE_HELP} class="cursor-help rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize {sourceClass[p.source]}">{p.source}</span>
							</td>
							<td class="px-4 py-3 text-sm">
								<span use:tooltip={VERIFIED_HELP} class="cursor-help rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize {verifiedClass(p.verified)}">{p.verified ?? '-'}</span>
							</td>
							<td class="px-4 py-3 text-sm text-muted" onclick={(e) => e.stopPropagation()}>
								<div class="flex flex-col gap-2">
									<form
										method="post"
										action="?/setSubscription"
										use:enhance={() => {
											switchingId = p.profileId;
											return async ({ result, update }) => {
												switchingId = null;
												if (result.type === 'failure') toast.error(String((result.data as { error?: string })?.error ?? 'Could not update package.'));
												else if (result.type === 'success' && (result.data as { tier?: string } | undefined)?.tier) {
													toast.success(`${p.profileName}'s package set to ${(result.data as { tier: string }).tier}.`);
												}
												await update();
											};
										}}
									>
										<input type="hidden" name="profileId" value={p.profileId} />
										<select
											name="tier"
											value={p.subscriptionTier ?? 'kickstart'}
											disabled={switchingId === p.profileId}
											onchange={(e) => e.currentTarget.form?.requestSubmit()}
											aria-label="Switch {p.profileName}'s package"
											class="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold text-heading capitalize focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none disabled:opacity-60"
										>
											{#each TIERS as t (t)}
												<option value={t}>{t}</option>
											{/each}
										</select>
									</form>
									{#if p.subscriptionTier}
										<span class="text-xs">Exp: {dateOnlyFmt.format(new Date(p.subscriptionExpiresAt!))}</span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-3 text-sm text-muted" onclick={(e) => e.stopPropagation()}>
								<div class="flex items-center gap-2">
									<span class="font-medium text-heading tabular-nums">{p.creditsBalance}</span>
									<button
										type="button"
										onclick={() => {
											grantingFor = { profileId: p.profileId, profileName: p.profileName };
											grantAmount = '';
										}}
										class="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-heading transition hover:bg-surface-2"
									>
										Grant
									</button>
								</div>
							</td>
							<td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
								<div class="flex items-center gap-1.5">
									<a href={p.adminPath} class="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary transition hover:brightness-95">Admin</a>
									<a href={p.profilePath} target="_blank" rel="noopener" class="rounded-full border border-border px-3 py-1 text-xs font-semibold text-heading transition hover:bg-surface-2">Preview &#8599;</a>
								</div>
							</td>
						</tr>
						{#if expandedId === p.profileId}
							<tr class="border-t border-border bg-surface-2" onclick={(e) => e.stopPropagation()}>
								<td colspan="10" class="px-4 py-4">
									{#if loadingId === p.profileId}
										<p class="text-sm text-muted">Loading…</p>
									{:else if extrasCache[p.profileId]}
										{@const extras = extrasCache[p.profileId]}
										<!-- Only one of the two histories renders per profile (they're keyed on
										source), so the single table takes the full row width. -->
										<div>
											<!-- Claim history: past claimants + verdicts. An applied profile can't be
											claimed, so this shows only for seeded/claimed ones. -->
											{#if p.source !== 'applied'}
											<div>
												<h3 class="text-sm font-semibold text-heading">Claims on {p.profileName}</h3>
												{#if extras.claimHistory.length > 0}
													<div class="mt-2 overflow-x-auto rounded-xl border border-border">
														<table class="w-full min-w-248 border-collapse text-left">
															<thead>
																<tr class="bg-surface">
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Claim ID</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Role</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Claimant</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Email</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Phone</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">National ID</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Requested</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Reviewed</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Reviewer</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Outcome</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Notes</th>
																</tr>
															</thead>
															<tbody>
																{#each extras.claimHistory as h (h.id)}
																	<tr class="border-t border-border">
																		<td class="px-3 py-2 text-xs text-muted">{h.id}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.role ?? '-'}</td>
																		<td class="px-3 py-2 text-xs text-heading">{h.claimantName}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.email ?? '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.phone ?? '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.nationalId ?? '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{dateFmt.format(new Date(h.requestedAt))}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.reviewedAt ? dateFmt.format(new Date(h.reviewedAt)) : '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.reviewerName ?? '-'}</td>
																		<td class="px-3 py-2 text-xs capitalize text-heading">{h.deleted ? 'withdrawn' : (h.outcome ?? 'pending')}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.notes ?? '-'}</td>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												{:else}
													<p class="mt-1 text-sm text-muted">No claims on this profile.</p>
												{/if}
											</div>
											{/if}

											<!-- Application history: every application the profile's APPLICANT submitted,
											across every candidate they represent, for applied profiles only. -->
											{#if p.source === 'applied'}
											<div>
												<h3 class="text-sm font-semibold text-heading">Applications by {extras.applicantName ?? 'the applicant'}</h3>
												{#if extras.applications.length > 0}
													<div class="mt-2 overflow-x-auto rounded-xl border border-border">
														<table class="w-full min-w-120 border-collapse text-left">
															<thead>
																<tr class="bg-surface">
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Candidate</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Role</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">National ID</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Requested</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Reviewed</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Reviewer</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Outcome</th>
																	<th class="px-3 py-2 text-xs font-semibold text-heading">Notes</th>
																</tr>
															</thead>
															<tbody>
																{#each extras.applications as h (h.id)}
																	<tr class="border-t border-border">
																		<td class="px-3 py-2 text-xs text-heading">{h.candidateName}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.role ?? '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.nationalId ?? '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{dateFmt.format(new Date(h.requestedAt))}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.reviewedAt ? dateFmt.format(new Date(h.reviewedAt)) : '-'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.reviewerName ?? '-'}</td>
																		<td class="px-3 py-2 text-xs capitalize text-heading">{h.outcome ?? 'pending'}</td>
																		<td class="px-3 py-2 text-xs text-muted">{h.notes ?? '-'}</td>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												{:else}
													<p class="mt-1 text-sm text-muted">No applications by {extras.applicantName ?? 'the applicant'}.</p>
												{/if}
											</div>
											{/if}
										</div>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<Pagination page={data.page} {totalPages} total={data.total} itemLabel="profiles" href={pagerHref} />
	{:else}
		<p class="mt-6 text-sm text-muted">{data.q ? `No profiles match “${data.q}”.` : 'No profiles yet.'}</p>
	{/if}

	{#if grantingFor}
		<div class="fixed inset-0 z-50 grid place-items-center p-4">
			<button type="button" aria-label="Cancel" onclick={() => (grantingFor = null)} class="absolute inset-0 bg-black/70"></button>
			<div role="dialog" aria-modal="true" aria-label="Grant credits" class="relative w-full max-w-sm rounded-2xl bg-surface p-6">
				<p class="font-semibold text-heading">Grant credits to {grantingFor.profileName}</p>
				<form
					method="post"
					action="?/grantCredits"
					class="mt-3"
					use:enhance={() => {
						granting = true;
						return async ({ result, update }) => {
							granting = false;
							if (result.type === 'success') {
								toast.success(`Granted ${grantAmount} credit${grantAmount === 1 ? '' : 's'} to ${grantingFor?.profileName}.`);
								grantingFor = null;
							} else if (result.type === 'failure') {
								toast.error(String((result.data as { error?: string })?.error ?? 'Could not grant credits.'));
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="profileId" value={grantingFor.profileId} />
					<label class="block">
						<span class="text-xs font-medium text-muted">Amount (credits)</span>
						<input
							type="number"
							name="amount"
							min="1"
							bind:value={grantAmount}
							class="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
						/>
					</label>
					<div class="mt-5 flex justify-end gap-2">
						<button
							type="button"
							onclick={() => (grantingFor = null)}
							class="rounded-full border border-border px-5 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={grantAmount === '' || grantAmount <= 0 || granting}
							class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
						>
							{granting ? 'Granting…' : 'Grant'}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
