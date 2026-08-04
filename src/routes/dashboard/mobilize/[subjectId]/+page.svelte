<script lang="ts">
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import FollowersTable from '$lib/components/FollowersTable.svelte';
	import DataTable, { type Column } from '$lib/components/DataTable.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Tab = 'followers' | 'pledges' | 'events' | 'feedback';
	const tabs: { id: Tab; label: string; count: number }[] = $derived([
		{ id: 'followers', label: 'Followers', count: data.total },
		{ id: 'pledges', label: 'Pledges', count: data.pledgeTotal },
		{ id: 'events', label: 'Events', count: data.events.length },
		{ id: 'feedback', label: 'Feedback', count: data.feedback.length }
	]);
	// Active sub-tab comes from the URL so a paginated reload (?tab=&page=) reopens
	// the right one; switching is client-side, kept in the URL via replaceState.
	let activeTab = $state<Tab>((pageState.url.searchParams.get('tab') as Tab) ?? 'followers');
	function openTab(t: Tab) {
		activeTab = t;
		replaceState(`?tab=${t}`, {});
	}

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
	const dayFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const fmtWhen = (iso: string) => dateFmt.format(new Date(iso));

	const pledgeColumns: Column<(typeof data.pledges)[number]>[] = [
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'phone', label: 'Phone' },
		{ key: 'email', label: 'Email' },
		{ key: 'ward', label: 'Ward', sortable: true },
		{ key: 'pledgedAt', label: 'Pledged', sortable: true, format: (v) => dayFmt.format(new Date(String(v))) }
	];

	const sentimentClass: Record<string, string> = {
		positive: 'bg-primary-soft text-on-primary',
		neutral: 'bg-surface-2 text-muted',
		negative: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
	};

	let savingPledge = $state(false);
</script>

<svelte:head><title>Ambassador: {data.assignment.leaderName} · vote.ke</title></svelte:head>

<div>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<p class="mt-1 text-sm text-muted">
				Mobilizing for
				<a href={data.assignment.leaderPath} class="font-medium text-heading hover:text-primary">
					{data.assignment.positionTitle} {data.assignment.leaderName}, {data.assignment.region}
				</a>
			</p>
		</div>
		<form
			method="post"
			action="?/leave"
			use:enhance={({ cancel }) => {
				if (!confirm(`Leave ${data.assignment.leaderName}'s campaign?`)) cancel();
			}}
		>
			<input type="hidden" name="ambassadorId" value={data.assignment.id} />
			<button
				type="submit"
				class="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface-2 hover:text-heading"
			>
				Leave campaign
			</button>
		</form>
	</div>

	{#if form?.error}
		<div class="mt-4 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{form.error}</div>
	{:else if form?.added}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">{form.added.name} now follows this campaign.</div>
	{:else if form?.pledged}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">{form.pledged.name}'s pledge recorded.</div>
	{:else if form?.eventLogged}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">Event logged. Your manager can confirm it happened.</div>
	{:else if form?.feedbackLogged}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">Feedback recorded.</div>
	{/if}

	<!-- Sub-tabs: keep the four workspaces off one long page. -->
	<div class="mt-6 flex flex-wrap gap-1 border-b border-border">
		{#each tabs as t (t.id)}
			<button
				type="button"
				onclick={() => openTab(t.id)}
				class="-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition {activeTab === t.id
					? 'border-primary text-heading'
					: 'border-transparent text-muted hover:text-heading'}"
			>
				{t.label} <span class="text-xs font-normal text-muted">({t.count})</span>
			</button>
		{/each}
	</div>

	{#if activeTab === 'followers'}
		<!-- Followers: citizens recruited to receive campaign news (funnel A). -->
		<div class="mt-6">
			<FollowersTable
				followers={data.recruits}
				total={data.total}
				page={data.followerPage}
				pageSize={data.pageSize}
				pagerHref={(p) => `?tab=followers&page=${p}`}
				county={data.assignment.region}
			/>
		</div>
	{:else if activeTab === 'pledges'}
		<!-- Pledges: citizens who pledged their 2027 vote. A separate flow from
		following, since some pledge without wanting news updates. -->
		<div class="mt-6">
			<p class="text-sm text-muted">Record a citizen's vote pledge. Separate from followers: a pledge is a promise to vote, not a news opt-in.</p>
			{#if data.campaignAcceptsPledges}
				<form
					method="post"
					action="?/logPledge"
					class="mt-4 rounded-2xl border border-border bg-surface-2 p-4"
					use:enhance={() => {
						savingPledge = true;
						return async ({ result, update }) => {
							savingPledge = false;
							await update({ reset: result.type === 'success' });
						};
					}}
				>
					<div class="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
						<label class="block">
							<span class="text-xs font-medium text-muted">Name <span class="text-red-500">*</span></span>
							<input type="text" name="name" required placeholder="Wanjiku Kamau" class="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
						</label>
						<label class="block">
							<span class="text-xs font-medium text-muted">Phone</span>
							<input type="tel" name="phone" placeholder="0712 345 678" class="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
						</label>
						<label class="block">
							<span class="text-xs font-medium text-muted">Email</span>
							<input type="email" name="email" placeholder="citizen@email.com" class="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
						</label>
						<label class="block">
							<span class="text-xs font-medium text-muted">Ward (optional)</span>
							<input type="text" name="ward" placeholder="Kiharu" class="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
						</label>
						<button type="submit" disabled={savingPledge} class="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-primary transition hover:border-primary disabled:opacity-60">
							{savingPledge ? 'Recording…' : 'Record pledge'}
						</button>
					</div>
					<input type="hidden" name="county" value={data.assignment.region} />
					<p class="mt-2 text-xs text-muted">Contact is optional for a pledge. Only add it if the citizen agreed to be reached.</p>
				</form>
			{:else}
				<p class="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
					This campaign has no active 2027 run yet, so it can't take pledges.
				</p>
			{/if}

			<div class="mt-4">
				<DataTable
					columns={pledgeColumns}
					rows={data.pledges}
					itemLabel="pledges"
					total={data.pledgeTotal}
					page={data.pledgePage}
					pageSize={data.pageSize}
					pagerHref={(p) => `?tab=pledges&page=${p}`}
				/>
			</div>
		</div>
	{:else if activeTab === 'events'}
		<!-- Events: field events the ambassador runs; a manager confirms each. -->
		<div class="mt-6">
			<p class="text-sm text-muted">Log a rally, meeting, or door-to-door drive. Your manager confirms it happened.</p>
			<form method="post" action="?/logEvent" use:enhance class="mt-4 grid gap-3 rounded-2xl border border-border bg-surface-2 p-4 sm:grid-cols-2">
				<input type="text" name="title" required placeholder="What was it? (e.g. Kibra market walkabout)" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none sm:col-span-2" />
				<label class="flex flex-col gap-1 text-xs font-medium text-muted">
					When
					<input type="datetime-local" name="scheduledFor" required class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none" />
				</label>
				<label class="flex flex-col gap-1 text-xs font-medium text-muted">
					Turnout (optional)
					<input type="number" name="turnout" min="0" placeholder="e.g. 120" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
				</label>
				<select name="county" aria-label="County" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none">
					<option value="">County (optional)</option>
					{#each data.countyNames as c (c)}<option value={c}>{c}</option>{/each}
				</select>
				<input type="text" name="ward" placeholder="Ward (optional)" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
				<textarea name="description" rows="2" placeholder="Notes (optional)" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none sm:col-span-2"></textarea>
				<div class="sm:col-span-2">
					<button type="submit" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Log event</button>
				</div>
			</form>

			{#if data.events.length > 0}
				<ul class="mt-4 space-y-3">
					{#each data.events as ev (ev.id)}
						<li class="rounded-2xl border border-border bg-surface p-4">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div>
									<p class="font-semibold text-heading">{ev.title}</p>
									<p class="mt-0.5 text-xs text-muted">
										{fmtWhen(ev.scheduledFor)}
										{#if ev.county}· {ev.county}{/if}{#if ev.ward}, {ev.ward}{/if}
										{#if ev.turnout != null}· {ev.turnout} turned out{/if}
									</p>
								</div>
								<div class="flex items-center gap-2">
									{#if ev.confirmed}
										<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">Confirmed</span>
									{:else}
										<span class="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">Awaiting confirmation</span>
									{/if}
									<form method="post" action="?/deleteEvent" use:enhance={({ cancel }) => {
											if (!confirm('Delete this event?')) cancel();
										}}>
										<input type="hidden" name="eventId" value={ev.id} />
										<button type="submit" aria-label="Delete event" class="text-xs font-semibold text-muted hover:text-red-600">Delete</button>
									</form>
								</div>
							</div>
							{#if ev.description}<p class="mt-2 text-sm text-muted">{ev.description}</p>{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">No events logged yet.</p>
			{/if}
		</div>
	{:else if activeTab === 'feedback'}
		<!-- Feedback: what citizens said in the field. -->
		<div class="mt-6">
			<p class="text-sm text-muted">Record what citizens told you in the field. It feeds the campaign's ground read.</p>
			<form method="post" action="?/logFeedback" use:enhance class="mt-4 grid gap-3 rounded-2xl border border-border bg-surface-2 p-4 sm:grid-cols-2">
				<input type="text" name="citizenName" placeholder="Citizen name (optional)" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
				<select name="sentiment" aria-label="Sentiment" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none">
					<option value="positive">Positive</option>
					<option value="neutral" selected>Neutral</option>
					<option value="negative">Negative</option>
				</select>
				<select name="county" aria-label="County" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none">
					<option value="">County (optional)</option>
					{#each data.countyNames as c (c)}<option value={c}>{c}</option>{/each}
				</select>
				<input type="text" name="ward" placeholder="Ward (optional)" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none" />
				<textarea name="message" required rows="2" placeholder="What did they say?" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none sm:col-span-2"></textarea>
				<div class="sm:col-span-2">
					<button type="submit" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Record feedback</button>
				</div>
			</form>

			{#if data.feedback.length > 0}
				<ul class="mt-4 space-y-3">
					{#each data.feedback as fb (fb.id)}
						<li class="rounded-2xl border border-border bg-surface p-4">
							<div class="flex flex-wrap items-center gap-2">
								<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize {sentimentClass[fb.sentiment]}">{fb.sentiment}</span>
								<span class="text-sm font-medium text-heading">{fb.citizenName ?? 'Anonymous'}</span>
								{#if fb.county}<span class="text-xs text-muted">· {fb.county}{#if fb.ward}, {fb.ward}{/if}</span>{/if}
							</div>
							<p class="mt-2 text-sm text-muted">{fb.message}</p>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">No feedback recorded yet.</p>
			{/if}
		</div>
	{/if}
</div>
