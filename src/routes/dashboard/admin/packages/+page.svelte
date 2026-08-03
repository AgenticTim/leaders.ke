<script lang="ts">
	import { tooltip } from '$lib/effects';
	// pricing-v2: one flat rate card for every office — a single table, no more
	// one-per-seat-band split. Mirrors the public pricing page's "Features per
	// package" layout: tiers as columns, a row per price or cap. Every cell saves
	// on change; an empty cap means unlimited. Seed values come from
	// src/lib/data/packages.json (bun run db:seed -- --packages).
	import { enhance } from '$app/forms';
	import { toast } from '$lib/stores/toast';
	import packageData from '$lib/data/packages.json';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Shared by every autosave form below (rate/feature/perk cells, invite
	// limits, credit rates): one toast per submit instead of repeating the
	// same result-handling in each of the ~20 near-identical forms.
	function enhanceWithToast() {
		return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			if (result.type === 'failure') toast.error(String(result.data?.error ?? 'Could not save.'));
			else if (result.type === 'success') toast.success('Saved.');
			await update({ reset: false });
		};
	}

	const TIERS = ['kickstart', 'mobilize', 'dominate'] as const;
	const CYCLES = ['monthly', 'annual'] as const;
	const FEATURES = [
		{ key: 'managers', label: 'Campaign managers' },
		{ key: 'ambassadors', label: 'Campaign ambassadors' },
		{ key: 'subscriptions', label: 'Citizen subscriptions' },
		{ key: 'creditsPerMonth', label: 'Credits included/mo' },
		{ key: 'knowledgeMb', label: 'Knowledge upload (MB)' }
	] as const;
	// On/off perks — the key ORDER matches $lib/server/packages.ts's
	// PACKAGE_PERK_KEYS; each label comes from packages.json's perkLabels (the
	// same file /pricing and packages.ts read), so wording only changes once.
	const PERK_KEYS = [
		'analytics',
		'prAiAgent',
		'newsSourceControl',
		'sentimentSuite',
		'voterHeatmap'
	] as const;
	const PERKS = PERK_KEYS.map((key) => ({ key, label: packageData.perkLabels[key] }));

	const rate = (tier: string, cycle: string) =>
		data.pricing.find((p) => p.tier === tier && p.billingCycle === cycle);
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
		What each package costs and includes — one flat rate per tier, for every office. Edits save when
		you leave a field; an empty cap means unlimited. Rate changes never touch existing
		subscriptions, they only apply going forward.
	</p>

	<!-- PAYG credit rates: the /pricing Credits table, charged by broadcast.ts and
	the AI ask. Inputs submit together via the #credit-rates form below. -->
	<h2 class="mt-8 text-lg font-semibold text-heading">Credit rates</h2>
	<p class="text-xs text-muted">
		Pay-as-you-go prices spent from a campaign's wallet. These drive the /pricing Credits table.
	</p>
	<div class="mt-3 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-4">
		{#each [{ name: 'aiChatCostCredits', label: 'AI chat (per answer)', value: data.creditRates.aiChat, min: 1 }, { name: 'smsCostCredits', label: 'SMS (per message)', value: data.creditRates.sms, min: 1 }, { name: 'whatsappCostCredits', label: 'WhatsApp (per message)', value: data.creditRates.whatsapp, min: 1 }] as field (field.name)}
			<label class="block">
				<span class="text-xs font-medium text-muted">{field.label}</span>
				<input
					type="number"
					form="credit-rates"
					name={field.name}
					min={field.min}
					value={field.value}
					onchange={submitOnChange}
					class="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				/>
			</label>
		{/each}
		<label class="block">
			<span class="text-xs font-medium text-muted">Downgrade fee (%)</span>
			<input
				type="number"
				form="credit-rates"
				name="downgradeFeePercent"
				min="0"
				max="100"
				value={data.creditRates.downgradeFeePercent}
				onchange={submitOnChange}
				use:tooltip={'Withheld from the credits a downgrade returns to the wallet. 0 disables it.'}
				class="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
			/>
		</label>
	</div>

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
						<th class="px-4 py-3 text-sm font-medium text-heading capitalize"
							>{cycle} price (KES)</th
						>
						{#each TIERS as tier (tier)}
							{@const current = rate(tier, cycle)}
							<td class="px-4 py-3">
								<form method="post" action="?/setRate" use:enhance={enhanceWithToast}>
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
								<form method="post" action="?/setFeature" use:enhance={enhanceWithToast}>
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
									use:enhance={enhanceWithToast}
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
	<form id="invite-limits" method="post" action="?/saveInviteLimits" use:enhance={enhanceWithToast}></form>
	<!-- Owns the credit-rate inputs above (via form="credit-rates"). -->
	<form id="credit-rates" method="post" action="?/saveCreditRates" use:enhance={enhanceWithToast}></form>
</div>
