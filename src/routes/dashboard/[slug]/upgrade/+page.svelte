<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const TIER_KEYS = ['kickstart', 'mobilize', 'dominate'] as const;
	const tierLabels: Record<string, string> = {
		kickstart: 'Kickstart',
		mobilize: 'Mobilize',
		dominate: 'Dominate'
	};
	const taglines: Record<string, string> = {
		kickstart: 'Launch your bid',
		mobilize: 'Grow your movement',
		dominate: 'Command the race'
	};

	const fmt = new Intl.NumberFormat('en-KE');
	const fmtCap = (n: number | null) => (n === null ? 'Unlimited' : fmt.format(n));

	let cycle = $state<'monthly' | 'annual'>(
		(data.currentCycle as 'monthly' | 'annual') ?? 'monthly'
	);
	let switching = $state<string | null>(null);

	const rate = (tier: string, c: string) =>
		data.pricing.find((p) => p.tier === tier && p.billingCycle === c)?.amount ?? 0;
	const featuresOf = (tier: string) => data.packages.find((p) => p.tier === tier)?.features;

	const rank = (tier: string) => TIER_KEYS.indexOf(tier as (typeof TIER_KEYS)[number]);
	const relation = (tier: string) => {
		if (tier === data.currentTier) return cycle === data.currentCycle ? 'current' : 'switch';
		return rank(tier) > rank(data.currentTier) ? 'upgrade' : 'downgrade';
	};

	// Card highlight bullets from the same features the caps come from (mirrors
	// the /pricing page), so a package edit shows up here too.
	const highlightsOf = (tier: string): string[] => {
		const f = featuresOf(tier);
		if (!f) return [];
		const out: string[] = [];
		if (f.managers === null && f.ambassadors === null && f.subscriptions === null) {
			out.push('Unlimited managers', 'Unlimited ambassadors', 'Unlimited subscriptions');
		} else {
			out.push(
				`${fmtCap(f.managers)} campaign managers`,
				`${fmtCap(f.ambassadors)} ambassadors`,
				`${fmtCap(f.subscriptions)} citizen subscriptions`
			);
		}
		out.push(`${fmtCap(f.creditsPerMonth)} credits/mo`);
		for (const key of data.perkKeys) if (f[key]) out.push(data.perkLabels[key]);
		return out;
	};

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	// Mirror of the server's computeProration (subscriptionUpgrade.ts) so the
	// confirm modal previews the exact numbers the action will apply. 1 credit =
	// KES 1: the current plan's unused value discounts the new price, any excess
	// spills into credits.
	function proration(newListPrice: number) {
		const start = data.currentStartAt ? new Date(data.currentStartAt).getTime() : null;
		const end = data.currentEndsAt ? new Date(data.currentEndsAt).getTime() : null;
		const now = Date.now();
		let remainder = 0;
		if (start !== null && end !== null && end > now && end > start && data.currentAmount > 0) {
			remainder = Math.max(
				0,
				Math.min(Math.round(data.currentAmount * ((end - now) / (end - start))), data.currentAmount)
			);
		}
		const applied = Math.min(remainder, newListPrice);
		return {
			remainder,
			applied,
			chargeNow: newListPrice - applied,
			excessCredits: remainder - applied
		};
	}

	const daysLeft = $derived(
		data.currentEndsAt
			? Math.max(0, Math.ceil((new Date(data.currentEndsAt).getTime() - Date.now()) / 86_400_000))
			: 0
	);

	// The plan the confirm modal is about (null = closed).
	let confirmTier = $state<string | null>(null);
	const confirmPreview = $derived(confirmTier ? proration(rate(confirmTier, cycle)) : null);
</script>

<svelte:head><title>Change plan — Dashboard</title></svelte:head>

<div class="">
	<div class="flex flex-col sm:flex-row justify-between text-xl font-bold text-heading">
		<span>{tierLabels[data.currentTier]} Plan</span>
		<span><span class="text-muted">Credit: KES</span> <span>{data.credits.toLocaleString()}</span></span>
	</div>
	<p class="mt-2 text-sm text-muted">
		Subscribed on {dateFmt.format(new Date(data.currentStartAt))}. 
		Active until {dateFmt.format(new Date(data.currentEndsAt))}. 
		Switch tiers any time. The new plan takes effect immediately.
	</p>

	{#if !data.canManageBilling}
		<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm text-muted">
			Only a campaign admin can change the plan. Ask the campaign owner or an admin manager to
			upgrade.
		</div>
	{/if}

	{#if form?.error}
		<div
			class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading"
		>
			{form.error}
		</div>
	{/if}
	
	<h1 class="mt-6 text-xl font-bold text-heading">Change plan</h1>
	
	<p class="mt-2 text-sm text-muted">
		Changing plans starts a fresh billing term. Any unused value from your current plan is credited
		toward the new one, and anything left over is added to your wallet.
	</p>
	<!-- Monthly / annual toggle: annual is 10x monthly (2 months free), same as /pricing. -->
	<div class="flex justify-center">
		<div class="mt-4 inline-flex rounded-full border border-border bg-surface p-1 text-sm">
			{#each [{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual · 2 months free' }] as const as opt (opt.value)}
				<button
					type="button"
					onclick={() => (cycle = opt.value)}
					class="rounded-full px-4 py-1.5 font-semibold transition {cycle === opt.value
						? 'bg-primary text-on-primary'
						: 'text-muted hover:text-heading'}"
				>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-6 grid gap-4 md:grid-cols-3">
		{#each TIER_KEYS as tier (tier)}
			{@const rel = relation(tier)}
			<div
				class="flex flex-col rounded-2xl border bg-surface p-5 {rel === 'current'
					? 'border-primary'
					: 'border-border'}"
			>
				<div class="flex items-baseline justify-between">
					<h2 class="text-lg font-bold text-heading">{tierLabels[tier]}</h2>
					{#if rel === 'current'}
						<span
							class="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-on-primary"
							>Current</span
						>
					{/if}
				</div>
				<p class="mt-0.5 text-xs text-muted">{taglines[tier]}</p>
				<p class="mt-3">
					<span class="text-2xl font-extrabold tabular-nums text-heading"
						>KES {fmt.format(rate(tier, cycle))}</span
					>
					<span class="text-xs text-muted">/{cycle === 'annual' ? 'yr' : 'mo'}</span>
				</p>

				<ul class="mt-4 flex-1 space-y-1.5 text-sm text-muted">
					{#each highlightsOf(tier) as h (h)}
						<li class="flex gap-2"><span class="text-primary">✓</span><span>{h}</span></li>
					{/each}
				</ul>

				{#if rel === 'current'}
					<button
						type="button"
						disabled
						class="mt-5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted"
					>
						Your current plan
					</button>
				{:else}
					<!-- Opens the confirm modal (which explains the proration credit)
					rather than submitting straight away. -->
					<button
						type="button"
						onclick={() => (confirmTier = tier)}
						disabled={!data.canManageBilling || switching !== null}
						class="mt-5 w-full rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-60 {rel ===
						'downgrade'
							? 'border border-border text-heading hover:bg-surface-2'
							: 'bg-primary text-on-primary hover:brightness-95'}"
					>
						{#if rel === 'downgrade'}
							Downgrade to {tierLabels[tier]}
						{:else if rel === 'switch'}
							Switch to {cycle === 'annual' ? 'annual' : 'monthly'}
						{:else}
							Upgrade to {tierLabels[tier]}
						{/if}
					</button>
				{/if}
			</div>
		{/each}
	</div>
</div>

<!-- Confirm modal: spells out the money before applying — remaining value, what
it covers, what you pay now, and any credits granted. -->
{#if confirmTier && confirmPreview}
	{@const p = confirmPreview}
	{@const listPrice = rate(confirmTier, cycle)}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
			<h2 class="text-lg font-bold text-heading">
				{rank(confirmTier) < rank(data.currentTier) ? 'Downgrade' : 'Switch'} to {tierLabels[
					confirmTier
				]}
			</h2>
			<p class="mt-1 text-sm text-muted">
				{cycle === 'annual' ? 'Annual' : 'Monthly'} billing. Here's what happens:
			</p>

			<dl class="mt-4 space-y-2 text-sm">
				<div class="flex justify-between">
					<dt class="text-muted">{tierLabels[confirmTier]} {cycle} price</dt>
					<dd class="font-semibold tabular-nums text-heading">KES {fmt.format(listPrice)}</dd>
				</div>
				{#if p.remainder > 0}
					<div class="flex justify-between">
						<dt class="text-muted">
							Unused value of your {tierLabels[data.currentTier]} plan{#if daysLeft > 0}
								({daysLeft} day{daysLeft === 1 ? '' : 's'} left){/if}
						</dt>
						<dd class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
							− KES {fmt.format(p.applied)}
						</dd>
					</div>
				{/if}
				<div class="flex justify-between border-t border-border pt-2">
					<dt class="font-semibold text-heading">You pay now</dt>
					<dd class="text-base font-extrabold tabular-nums text-heading">
						KES {fmt.format(p.chargeNow)}
					</dd>
				</div>
				{#if p.excessCredits > 0}
					<div class="flex justify-between">
						<dt class="text-muted">Added to your wallet</dt>
						<dd class="font-semibold tabular-nums text-primary">
							+ {fmt.format(p.excessCredits)} credits
						</dd>
					</div>
				{/if}
			</dl>

			<p class="mt-3 text-xs text-muted">
				{#if p.chargeNow === 0}
					Your remaining balance fully covers this change — no payment needed{#if p.excessCredits > 0},
						and the leftover becomes wallet credits{/if}.
				{:else if data.paystackLive}
					You'll be taken to a secure payment page for the balance.
				{:else}
					Test mode: this applies instantly without a real charge.
				{/if}
			</p>

			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (confirmTier = null)}
					class="rounded-full px-4 py-2 text-sm font-medium text-muted transition hover:text-heading"
				>
					Cancel
				</button>
				<form
					method="post"
					action="?/upgrade"
					use:enhance={() => {
						switching = confirmTier;
						return async ({ update }) => {
							switching = null;
							confirmTier = null;
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="tier" value={confirmTier} />
					<input type="hidden" name="cycle" value={cycle} />
					<button
						type="submit"
						disabled={switching !== null}
						class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
					>
						{switching
							? 'Processing…'
							: p.chargeNow === 0
								? 'Confirm change'
								: `Pay KES ${fmt.format(p.chargeNow)}`}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
