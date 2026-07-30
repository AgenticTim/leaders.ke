<script lang="ts">
	import { enhance } from '$app/forms';
	import FollowersTable from '$lib/components/FollowersTable.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
	const fmtWhen = (iso: string) => dateFmt.format(new Date(iso));

	// Sentiment pill colours, kept in one place so the form legend and the list agree.
	const sentimentClass: Record<string, string> = {
		positive: 'bg-primary-soft text-on-primary',
		neutral: 'bg-surface-2 text-muted',
		negative: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
	};
</script>

<svelte:head><title>Ambassador: {data.assignment.leaderName} — vote.ke</title></svelte:head>

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
		<div class="mt-4 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">
			{form.error}
		</div>
	{:else if form?.added}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">
			{form.added.name} now follows this campaign.
		</div>
	{:else if form?.eventLogged}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">
			Event logged. Your manager can confirm it happened.
		</div>
	{:else if form?.feedbackLogged}
		<div class="mt-4 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">
			Feedback recorded.
		</div>
	{/if}

	<!-- Recruits (funnel A) -->
	<h2 class="mt-8 text-lg font-semibold text-heading">Your recruits</h2>
	<div class="mt-3">
		<FollowersTable
			followers={data.recruits}
			total={data.total}
			page={data.page}
			pageSize={data.pageSize}
			pagerHref={(p) => `?page=${p}`}
			county={data.assignment.region}
		/>
	</div>

	<!-- 17.1 Events: an ambassador logs the field events they run; a manager
	confirms each one actually happened before it counts. -->
	<h2 class="mt-10 text-lg font-semibold text-heading">Events</h2>
	<p class="mt-1 text-sm text-muted">Log a rally, meeting, or door-to-door drive. Your manager confirms it happened.</p>

	<form method="post" action="?/logEvent" use:enhance class="mt-4 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2">
		<input
			type="text"
			name="title"
			required
			placeholder="What was it? (e.g. Kibra market walkabout)"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none sm:col-span-2"
		/>
		<label class="flex flex-col gap-1 text-xs font-medium text-muted">
			When
			<input
				type="datetime-local"
				name="scheduledFor"
				required
				class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs font-medium text-muted">
			Turnout (optional)
			<input
				type="number"
				name="turnout"
				min="0"
				placeholder="e.g. 120"
				class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
			/>
		</label>
		<select
			name="county"
			aria-label="County"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none"
		>
			<option value="">County (optional)</option>
			{#each data.countyNames as c (c)}
				<option value={c}>{c}</option>
			{/each}
		</select>
		<input
			type="text"
			name="ward"
			placeholder="Ward (optional)"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
		/>
		<textarea
			name="description"
			rows="2"
			placeholder="Notes (optional)"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none sm:col-span-2"
		></textarea>
		<div class="sm:col-span-2">
			<button
				type="submit"
				class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
			>
				Log event
			</button>
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
					{#if ev.description}
						<p class="mt-2 text-sm text-muted">{ev.description}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">No events logged yet.</p>
	{/if}

	<!-- 17.2 Citizen feedback: what people on the ground are saying. -->
	<h2 class="mt-10 text-lg font-semibold text-heading">Citizen feedback</h2>
	<p class="mt-1 text-sm text-muted">Record what citizens told you in the field. It feeds the campaign's ground read.</p>

	<form method="post" action="?/logFeedback" use:enhance class="mt-4 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2">
		<input
			type="text"
			name="citizenName"
			placeholder="Citizen name (optional)"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
		/>
		<select
			name="sentiment"
			aria-label="Sentiment"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none"
		>
			<option value="positive">Positive</option>
			<option value="neutral" selected>Neutral</option>
			<option value="negative">Negative</option>
		</select>
		<select
			name="county"
			aria-label="County"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:outline-none"
		>
			<option value="">County (optional)</option>
			{#each data.countyNames as c (c)}
				<option value={c}>{c}</option>
			{/each}
		</select>
		<input
			type="text"
			name="ward"
			placeholder="Ward (optional)"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
		/>
		<textarea
			name="message"
			required
			rows="2"
			placeholder="What did they say?"
			class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none sm:col-span-2"
		></textarea>
		<div class="sm:col-span-2">
			<button
				type="submit"
				class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
			>
				Record feedback
			</button>
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
