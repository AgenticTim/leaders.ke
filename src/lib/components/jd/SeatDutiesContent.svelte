<script lang="ts">
	// The body of a seat's job description (summary + cited duty groups) —
	// rendered inline on the seat hub and inside the SeatJD modal. Source data
	// is the Constitution / County Governments Act (see seatDuties.ts).
	import type { SeatDuties } from '$lib/data/seatDuties';
	import type { SrcPay } from '$lib/data/srcPay';

	let {
		duties,
		pay = null
	}: {
		duties: SeatDuties;
		/** SRC pay for the seat, rendered as a Salary section. */
		pay?: (SrcPay & { source: string }) | null;
	} = $props();

	const fmt = new Intl.NumberFormat('en-KE');
</script>

<p class="mt-2 text-sm text-muted">{duties.summary}</p>
{#if pay}
	<div class="mt-4 rounded-3xl border border-border bg-surface-2 p-5">
		<h3 class="font-semibold text-heading">Salary</h3>
		<p class="mt-2 text-2xl font-extrabold tracking-tight text-heading">
			KSh {fmt.format(pay.monthlyGross)}<span class="text-base font-medium text-muted">/mo</span>
		</p>
		<p class="mt-1 text-sm text-muted">KSh {fmt.format(pay.monthlyGross * 12)} a year, gross.</p>
		<p class="mt-3 text-xs leading-relaxed text-muted">
			Gross monthly pay for this seat, {pay.source}.<br />
			Excludes the perks SRC sets separately (mileage, car grant, house or car loans, sitting allowances).
		</p>
		<p class="mt-2 text-xs text-muted">
			Source: Salaries and Remuneration Commission (SRC)
		</p>
	</div>
{/if}
<div class="mt-4 grid gap-4">
	{#each duties.groups as group (group.heading)}
		<div class="flex flex-col rounded-3xl border border-border bg-surface-2 p-5">
			<h3 class="font-semibold text-heading">{group.heading}</h3>
			<ul class="mt-3 space-y-2 text-sm leading-relaxed">
				{#each group.items as item (item)}
					<li class="flex gap-2"><span class="text-primary" aria-hidden="true">•</span><span>{item}</span></li>
				{/each}
			</ul>
			<p class="mt-auto pt-4 text-xs text-muted">
				Source:
				<a href={group.sourceUrl} target="_blank" rel="noopener" class="underline hover:text-heading">
					{group.sourceLabel}
				</a>
			</p>
		</div>
	{/each}
</div>
