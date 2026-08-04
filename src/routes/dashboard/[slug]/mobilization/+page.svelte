<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
	const fmtWhen = (iso: string) => dateFmt.format(new Date(iso));

	const sentimentClass: Record<string, string> = {
		positive: 'bg-primary-soft text-on-primary',
		neutral: 'bg-surface-2 text-muted',
		negative: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
	};

	// Unconfirmed first. Those need the manager's attention, then by date.
	const events = $derived(
		[...data.events].sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || b.scheduledFor.localeCompare(a.scheduledFor))
	);
	const pending = $derived(data.events.filter((e) => !e.confirmed).length);
</script>

<svelte:head><title>Mobilization · vote.ke</title></svelte:head>

{#if form?.confirmed}
	<div class="mb-6 rounded-xl bg-primary-soft p-4 text-sm font-medium text-on-primary">Event confirmed.</div>
{:else if form?.error}
	<div class="mb-6 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{form.error}</div>
{/if}

<div>
	<h2 class="text-lg font-semibold text-heading">
		Field events <span class="text-sm font-normal text-muted">({pending} awaiting confirmation)</span>
	</h2>
	<p class="mt-1 text-sm text-muted">Events your ambassadors logged. Confirm the ones that actually happened.</p>

	{#if events.length > 0}
		<ul class="mt-4 space-y-3">
			{#each events as ev (ev.id)}
				<li class="rounded-2xl border border-border bg-surface p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p class="font-semibold text-heading">{ev.title}</p>
							<p class="mt-0.5 text-xs text-muted">
								{fmtWhen(ev.scheduledFor)}
								{#if ev.county}· {ev.county}{/if}{#if ev.ward}, {ev.ward}{/if}
								{#if ev.turnout != null}· {ev.turnout} turned out{/if}
								· by {ev.ambassadorName}
							</p>
							{#if ev.description}<p class="mt-2 text-sm text-muted">{ev.description}</p>{/if}
						</div>
						<div class="shrink-0">
							{#if ev.confirmed}
								<span class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary">Confirmed</span>
							{:else}
								<form method="post" action="?/confirm" use:enhance>
									<input type="hidden" name="eventId" value={ev.id} />
									<button
										type="submit"
										class="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-on-primary transition hover:brightness-95"
									>
										Confirm it happened
									</button>
								</form>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
			No events logged yet. Ambassadors log them from their mobilize workspace.
		</p>
	{/if}

	<h2 class="mt-10 text-lg font-semibold text-heading">
		Citizen feedback <span class="text-sm font-normal text-muted">({data.feedback.length})</span>
	</h2>
	<p class="mt-1 text-sm text-muted">What citizens told your ambassadors in the field.</p>

	{#if data.feedback.length > 0}
		<ul class="mt-4 space-y-3">
			{#each data.feedback as fb (fb.id)}
				<li class="rounded-2xl border border-border bg-surface p-4">
					<div class="flex flex-wrap items-center gap-2">
						<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize {sentimentClass[fb.sentiment]}">{fb.sentiment}</span>
						<span class="text-sm font-medium text-heading">{fb.citizenName ?? 'Anonymous'}</span>
						{#if fb.county}<span class="text-xs text-muted">· {fb.county}{#if fb.ward}, {fb.ward}{/if}</span>{/if}
						<span class="text-xs text-muted">· via {fb.collectedByName}</span>
					</div>
					<p class="mt-2 text-sm text-muted">{fb.message}</p>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">No feedback gathered yet.</p>
	{/if}
</div>
