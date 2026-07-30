<script lang="ts">
	// pricing-v2: one flat rate card for every office — a single table, no more
	// one-per-seat-band split. Mirrors the public pricing page's "Features per
	// package" layout: tiers as columns, a row per price or cap. Every cell saves
	// on change; an empty cap means unlimited. Seed values come from
	// src/lib/data/packages.json (bun run db:seed -- --packages).
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const TIERS = ['kickstart', 'mobilize', 'dominate'] as const;
	const CYCLES = ['monthly', 'annual'] as const;
	const FEATURES = [
		{ key: 'managers', label: 'Campaign managers' },
		{ key: 'ambassadors', label: 'Campaign ambassadors' },
		{ key: 'subscriptions', label: 'Citizen subscriptions' },
		{ key: 'creditsPerMonth', label: 'Credits included/mo' },
		{ key: 'knowledgeMb', label: 'Knowledge upload (MB)' }
	] as const;
	// On/off perks — same list PERK_LABELS/PACKAGE_PERK_KEYS in packages.ts
	// drives; the /pricing comparison table reads the same features.
	const PERKS = [
		{ key: 'analytics', label: 'Analytics: page views, conversions, pledges' },
		{ key: 'prAiAgent', label: 'PR AI Agent: daily news research' },
		{ key: 'voterHeatmap', label: 'Voter heatmap per ward' },
		{ key: 'sentimentSuite', label: 'Sentiment Intelligence suite: campaign, competition' }
	] as const;

	const rate = (tier: string, cycle: string) => data.pricing.find((p) => p.tier === tier && p.billingCycle === cycle);
	const pkg = (tier: string) => data.packages.find((p) => p.tier === tier);

	// Autosave a cell when its value changes (blur/Enter) — no per-cell buttons.
	const submitOnChange = (e: Event) => (e.currentTarget as HTMLInputElement).form?.requestSubmit();

	const inputClass =
		'w-28 rounded-full border border-border bg-surface px-3 py-1 text-sm tabular-nums text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none';
</script>

<svelte:head><title>Packages — Admin</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">Packages</h1>
	<p class="mt-1 text-sm text-muted">
		What each package costs and includes — one flat rate per tier, for every office. Edits save
		when you leave a field; an empty cap means unlimited. Rate changes never touch existing
		subscriptions, they only apply going forward.
	</p>

	{#if form?.error}
		<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">
			{form.error}
		</div>
	{:else if form?.updated}
		<div class="mt-4 rounded-2xl bg-primary-soft p-4 text-sm font-medium text-on-primary">Saved.</div>
	{/if}

	<!-- Lifetime invites: a single jsonb setting — the inputs sit in their own
	cells but submit together via the #invite-limits form below. -->
	<h2 class="mt-8 text-lg font-semibold text-heading">Lifetime invites</h2>
	<p class="text-xs text-muted">Total team/follower invites a campaign may ever send.</p>
	<div class="mt-3 overflow-x-auto rounded-2xl border border-border">
		<table class="w-full min-w-160 table-fixed border-collapse text-left">
			<thead>
				<tr class="bg-surface-2">
					<th class="w-2/5 px-4 py-3 text-sm font-semibold text-heading">Package includes</th>
					{#each TIERS as tier (tier)}
						<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading capitalize">{tier}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				<tr class="border-t border-border">
					<th class="px-4 py-3 text-sm font-medium text-heading">Lifetime invites per campaign</th>
					{#each TIERS as tier (tier)}
						<td class="px-4 py-3">
							<input
								type="number"
								form="invite-limits"
								name={tier}
								min="1"
								value={data.inviteLimits[tier]}
								onchange={submitOnChange}
								aria-label="{tier} lifetime invites"
								class={inputClass}
							/>
						</td>
					{/each}
				</tr>
			</tbody>
		</table>
	</div>

	<!-- Prices then caps, tiers as columns -->
	<h2 class="mt-8 text-lg font-semibold text-heading">Rate card</h2>
	<p class="text-xs text-muted">Same price for every office — President and MCA pay the same.</p>
	<div class="mt-3 overflow-x-auto rounded-2xl border border-border">
		<table class="w-full min-w-160 table-fixed border-collapse text-left">
			<thead>
				<tr class="bg-surface-2">
					<th class="w-2/5 px-4 py-3 text-sm font-semibold text-heading">Package includes</th>
					{#each TIERS as tier (tier)}
						<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading capitalize">{tier}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each CYCLES as cycle (cycle)}
					<tr class="border-t border-border">
						<th class="px-4 py-3 text-sm font-medium text-heading capitalize">{cycle} price (KES)</th>
						{#each TIERS as tier (tier)}
							{@const current = rate(tier, cycle)}
							<td class="px-4 py-3">
								<form method="post" action="?/setRate" use:enhance>
									<input type="hidden" name="tier" value={tier} />
									<input type="hidden" name="billingCycle" value={cycle} />
									<input
										type="number"
										name="amount"
										min="1"
										value={current?.amount ?? ''}
										placeholder="—"
										onchange={submitOnChange}
										aria-label="{cycle} {tier} rate in KES"
										class={inputClass}
									/>
								</form>
							</td>
						{/each}
					</tr>
				{/each}
				{#each FEATURES as feature (feature.key)}
					<tr class="border-t border-border">
						<th class="px-4 py-3 text-sm font-medium text-heading">{feature.label}</th>
						{#each TIERS as tier (tier)}
							{@const features = pkg(tier)?.features}
							<td class="px-4 py-3">
								<form method="post" action="?/setFeature" use:enhance>
									<input type="hidden" name="tier" value={tier} />
									<input type="hidden" name="key" value={feature.key} />
									<input
										type="number"
										name="value"
										min="0"
										value={features?.[feature.key] ?? ''}
										placeholder="Unlimited"
										onchange={submitOnChange}
										aria-label="{tier} {feature.label}"
										class={inputClass}
									/>
								</form>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- On/off perks: same ✓/— rows the public /pricing page shows, sourced from
	the same packages.features the toggle below writes — one fact, two views. -->
	<h2 class="mt-8 text-lg font-semibold text-heading">Perks (on/off)</h2>
	<p class="text-xs text-muted">Shown as ✓/— on the public Pricing page's comparison table.</p>
	<div class="mt-3 overflow-x-auto rounded-2xl border border-border">
		<table class="w-full min-w-160 table-fixed border-collapse text-left">
			<thead>
				<tr class="bg-surface-2">
					<th class="w-2/5 px-4 py-3 text-sm font-semibold text-heading">Perk</th>
					{#each TIERS as tier (tier)}
						<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading capitalize">{tier}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each PERKS as perk (perk.key)}
					<tr class="border-t border-border">
						<th class="px-4 py-3 text-sm font-medium text-heading">{perk.label}</th>
						{#each TIERS as tier (tier)}
							{@const features = pkg(tier)?.features}
							<td class="px-4 py-3">
								<form
									method="post"
									action="?/setPerk"
									use:enhance
									onchange={(e) => (e.currentTarget as HTMLFormElement).requestSubmit()}
								>
									<input type="hidden" name="tier" value={tier} />
									<input type="hidden" name="key" value={perk.key} />
									<label class="inline-flex cursor-pointer items-center gap-2">
										<!-- Unchecked checkboxes are omitted from FormData entirely, so a
										same-name hidden fallback carries "false" — it must come AFTER
										the checkbox in document order so form.get('value') (first match)
										reads the checkbox's "true" when checked, the hidden "false" when not. -->
										<input
											type="checkbox"
											name="value"
											value="true"
											checked={!!features?.[perk.key]}
											aria-label="{tier} {perk.label}"
											class="size-4 rounded border-border text-primary focus:ring-0 focus:ring-ring"
										/>
										<input type="hidden" name="value" value="false" />
										<span class="text-sm text-muted">{features?.[perk.key] ? 'On' : 'Off'}</span>
									</label>
								</form>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Owns the invite-limit inputs above (via form="invite-limits") so the three
	tier caps submit together as the single jsonb setting they are. -->
	<form id="invite-limits" method="post" action="?/saveInviteLimits" use:enhance></form>
</div>
