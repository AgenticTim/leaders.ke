<script lang="ts">
	import Countdown from '$lib/components/Countdown.svelte';
	import WordCycler from '$lib/components/WordCycler.svelte';
	import packageData from '$lib/data/packages.json';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The key ORDER is literal here (drives iteration + matches packages.features'
	// shape); the LABEL text itself comes from packages.json's perkLabels. The
	// same file $lib/server/packages.ts and the admin Packages page read, so
	// wording only ever changes in one place.
	const PACKAGE_PERK_KEYS = [
		'analytics',
		'prAiAgent',
		'newsSourceControl',
		'sentimentSuite',
		'voterHeatmap'
	] as const;
	const PERK_LABELS: Record<(typeof PACKAGE_PERK_KEYS)[number], string> = packageData.perkLabels;

	const leftSet = ['Level Up', 'Catapult', 'Propel', 'Amplify', 'Strengthen'];
	const rightSet = ['Leadership', 'Campaign', 'Publicity', 'Advocacy', 'Supporters'];

	// pricing-v2 (leaders.ke-pricing-v2.csv): one flat rate per tier. Every
	// office costs the same, no more per-band price matrix.
	const TIER_KEYS = ['kickstart', 'mobilize', 'dominate'] as const;
	const tiers = ['Kickstart', 'Mobilize', 'Dominate'] as const;
	// Hand-written marketing copy per tier. The only part of this page NOT
	// sourced from the DB, since it's a pitch line, not a fact an admin edits.
	const taglines = ['Launch your bid', 'Grow your movement', 'Command the race'];

	const fmt = new Intl.NumberFormat('en-KE');
	const fmtCap = (n: number | null) => (n === null ? 'Unlimited' : fmt.format(n));

	// One monthly KES price per tier, same for every office, read from the
	// `pricing` table (the same rows /dashboard/admin/packages edits).
	const prices = TIER_KEYS.map(
		(tier) => data.pricing.find((p) => p.tier === tier && p.billingCycle === 'monthly')?.amount ?? 0
	);
	const packageFeatures = TIER_KEYS.map(
		(tier) => data.packages.find((p) => p.tier === tier)?.features
	);

	// Card highlight bullets, built from the same features every tier's caps
	// come from: managers/ambassadors/subscriptions collapse into one "Unlimited
	// ...” line when all three are unlimited (Dominate today), else list
	// separately; perks that are ON get their pricing-table label; credits close
	// the list. Nothing here is hand-typed, so a package edit shows up here too.
	const packages = TIER_KEYS.map((_tier, t) => {
		const f = packageFeatures[t];
		const highlights: string[] = [];
		if (f) {
			if (f.managers === null && f.ambassadors === null && f.subscriptions === null) {
				highlights.push('Unlimited managers');
				highlights.push('Unlimited ambassadors');
				highlights.push('Unlimited subscriptions');
			} else {
				highlights.push(`${fmtCap(f.managers)} campaign managers`);
				highlights.push(`${fmtCap(f.ambassadors)} ambassadors`);
				highlights.push(`${fmtCap(f.subscriptions)} citizen subscriptions`);
			}
			highlights.push(`${fmtCap(f.creditsPerMonth)} credits/mo`);
			for (const key of PACKAGE_PERK_KEYS) if (f[key]) highlights.push(PERK_LABELS[key]);
		}
		return { tagline: taglines[t], highlights };
	});

	// Base features every package includes, regardless of tier.
	const baseFeatures = [
		'Custom page, neat link, QR code',
		'Agentic AI chat on profile, campaign',
		'Publish manifesto and past delivery',
		'IEBC blue-check verification',
		'Private voter register',
		'Press desk: publish news, tag leaders, parties',
		'Broadcast to citizens using credits*',
		'Fundraising toolkit*',
		'Free support and platform maintenance'
	];

	// Network-effect features: only real value once other leaders are on the
	// platform too, so a private/DIY campaign site can never replicate them.
	// available is either '✓' (shipped) or a target month for what isn't yet.
	const networkFeatures = [
		{
			feature: 'Ballot simulator',
			description:
				"Citizens build and share their full 2027 ballot; every seat they fill drives traffic to that candidate's page - including yours, and to seats no one has claimed yet.",
			available: '✓',
			href: '/'
		},
		{
			feature: 'Voters are here',
			description:
				'Citizens come to vote.ke to compare candidates and simulate their ballot, so you launch where the voters already are instead of buying traffic to a page no one is looking for.',
			available: '✓',
			href: null
		},
		{
			feature: 'Agentic AI',
			description:
				'Scale your reach infinitely through an AI grounded on your data and instructions. Answer to your constituents 24/7/365 without hiring more staff or building your own system.',
			available: '✓',
			href: null
		},
		{
			feature: 'Compare',
			description:
				'Side by side manifesto, delivery record and reviews against rivals for the same seat.',
			available: '✓',
			href: '/compare'
		},
		{
			feature: 'Rank',
			description: 'Public leaderboard by seat, pulling traffic to every listed candidate.',
			available: '✓',
			href: '/rank'
		},
		{
			feature: 'Seat hub',
			description:
				'Your page listed alongside every rival for the seat, for context and credibility.',
			available: '✓',
			href: null
		},
		{
			feature: 'Coalition and alliance pages',
			description: 'Joint page for allied candidates across different seats.',
			available: '✓',
			href: '/alliances'
		},
		{
			feature: 'Party roster',
			description: 'Every candidate under one party, bundled on a single page.',
			available: '✓',
			href: '/parties'
		},
		{
			feature: 'Endorsement cards',
			description: 'Shareable graphics when a leader or alliance endorses you.',
			available: 'Aug 2026',
			href: null
		},
		{
			feature: 'Debate prep pack',
			description: "AI brief of your record against each rival's published record.",
			available: 'Aug 2026',
			href: null
		},
		{
			feature: 'Right of reply',
			description: "Respond inline when tagged in a rival's post or a news mention.",
			available: 'Aug 2026',
			href: null
		},
		{
			feature: 'Combo ticket pledges',
			description: 'A citizen pledges to a President, Governor and MP combo, tracked as one.',
			available: 'Aug 2026',
			href: null
		},
		{
			feature: 'Cross campaign ambassador pool',
			description: 'One ambassador mobilizing for a whole ticket, not just one candidate.',
			available: 'Sep 2026',
			href: null
		},
		{
			feature: 'Portable team reputation',
			description: 'A badge for managers and ambassadors who have worked on multiple campaigns.',
			available: 'Sep 2026',
			href: null
		},
		{
			feature: 'Benchmarking analytics',
			description: 'Your conversion rate compared to the average for your seat.',
			available: 'Sep 2026',
			href: null
		},
		{
			feature: 'Joint town hall',
			description: 'One question, compared answers from every candidate on the same seat.',
			available: 'Sep 2026',
			href: null
		}
	];

	// PAYG (pay-as-you-go) credits, KES 1 each. SMS/WhatsApp costs mirror the
	// broadcast footnote; AI chat's cost is the Sonnet 5 per-question figure
	// (docs/ai-chat-costs.md). Prices come from platformSettings (admin Packages
	// → Credit rates), not hardcoded, same single-source-of-truth rule as the
	// package/pricing tables above. Paid on-page placement ("Boost") is
	// deliberately not offered: money never reorders a neutral civic surface.
	const creditLabel = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
	const paygCredits = $derived([
		{
			item: 'AI chat',
			price: creditLabel(data.credits.aiChat),
			description: 'Per citizen question answered on your profile, campaign or channels.'
		},
		{
			item: 'SMS',
			price: creditLabel(data.credits.sms),
			description: 'Per SMS broadcast sent to a follower.'
		},
		{
			item: 'WhatsApp',
			price: creditLabel(data.credits.whatsapp),
			description: 'Per WhatsApp broadcast sent to a follower.'
		}
	]);

	// Annual billing bills 10 months (2 free). Toggle drives every price on the page.
	let annual = $state(false);
	const cycleMultiplier = $derived(annual ? 10 : 1);
	const cycleSuffix = $derived(annual ? '/yr' : '/mo');

	// Influencer (index 1) is the default active package; hovering/focusing another overrides it.
	let hovered = $state<number | null>(null);
	const active = $derived(hovered ?? 1);
</script>

{#snippet billingToggle()}
	<div
		class="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 p-1"
		role="group"
		aria-label="Billing cycle"
	>
		<button
			type="button"
			aria-pressed={!annual}
			onclick={() => (annual = false)}
			class="rounded-full px-4 py-1.5 text-sm font-semibold transition {!annual
				? 'bg-primary text-on-primary'
				: 'text-muted hover:text-heading'}"
		>
			Monthly
		</button>
		<button
			type="button"
			aria-pressed={annual}
			onclick={() => (annual = true)}
			class="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition {annual
				? 'bg-primary text-on-primary'
				: 'text-muted hover:text-heading'}"
		>
			Annual
			<span
				class="rounded-full px-1.5 py-0.5 text-xs {annual
					? 'bg-on-primary/15 text-on-primary'
					: 'bg-primary-soft text-on-primary'}"
			>
				2 months free
			</span>
		</button>
	</div>
{/snippet}

<svelte:head>
	<title>Pricing: vote.ke</title>
	<meta
		name="description"
		content="vote.ke subscription pricing: Kickstart, Mobilize and Dominate packages, one flat rate for every office."
	/>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-14 sm:px-6">
	<div class="text-center">
		<h1 class="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">
			<WordCycler words={leftSet} /> Your <WordCycler words={rightSet} />
		</h1>
		<p class="mx-auto mt-4 max-w-xl text-base leading-relaxed">
			A flat monthly rate plus PAYG to top up your broadcast credits.
		</p>
	</div>

	<!-- Interactive package cards -->
	<div class="mt-12 grid gap-6 md:grid-cols-3">
		{#each tiers as tier, t (tier)}
			<div
				role="group"
				aria-current={active === t ? 'true' : undefined}
				onmouseenter={() => (hovered = t)}
				onmouseleave={() => (hovered = null)}
				onfocusin={() => (hovered = t)}
				onfocusout={() => (hovered = null)}
				class="relative flex flex-col rounded-3xl border bg-surface p-6 transition-all duration-300 ease-out {active ===
				t
					? '-translate-y-1 scale-[1.03] border-primary shadow-lg ring-1 ring-primary'
					: 'border-border'}"
			>
				{#if t === 1}
					<span
						class="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-on-primary"
					>
						Most popular
					</span>
				{/if}

				<h2 class="text-lg font-bold text-heading">{tier}</h2>
				<p class="text-sm text-muted">{packages[t].tagline}</p>

				<p class="mt-4">
					<span class="text-2xl font-extrabold tabular-nums text-heading">
						KES {fmt.format(prices[t] * cycleMultiplier)}
					</span>
					<span class="text-sm text-muted">{cycleSuffix}</span>
				</p>

				<ul class="mt-4 flex-1 space-y-2">
					{#each packages[t].highlights as perk (perk)}
						<li class="flex items-start gap-2 text-sm">
							<span class="mt-0.5 text-primary">✓</span>
							<span>{perk}</span>
						</li>
					{/each}
				</ul>

				<!-- Always visible: the active package gets the filled button, the
				others an outline that fills on hover. -->
				<a
					href="/onboard/profile"
					class="mt-6 rounded-full border px-4 py-2.5 text-center font-semibold transition-all duration-300 focus:ring-0 focus:ring-ring focus:outline-none {active ===
					t
						? 'border-primary bg-primary text-on-primary hover:brightness-95'
						: 'border-primary bg-surface text-primary hover:bg-primary hover:text-on-primary'}"
				>
					Get started
				</a>
			</div>
		{/each}
	</div>

	<div class="mt-8 flex items-center justify-center">
		{@render billingToggle()}
	</div>

	<!-- Base features -->
	<div class="mt-12 rounded-2xl bg-surface-2 p-6">
		<div class="flex flex-wrap items-end justify-between gap-2">
			<h2 class="text-xl font-semibold text-heading">Included in every package</h2>
			<a href="/features" class="text-sm font-semibold text-primary hover:underline">
				Full feature list →
			</a>
		</div>
		<ul class="mt-4 grid gap-2 sm:grid-cols-3">
			{#each baseFeatures as feature (feature)}
				<li class="flex items-start gap-2 text-sm">
					<span class="mt-0.5 text-primary">✓</span>
					<span>{feature}</span>
				</li>
			{/each}
		</ul>
	</div>

	<div class="mt-8 text-center">
		<p class="mt-2 text-sm">
			Your payment helps us verify your candidature against IEBC records, continuously build and
			maintain our systems and pay for the infrastructure.
		</p>
	</div>

	<!-- Vote.ke vs a private/DIY campaign platform: features that only exist
	     because other leaders are on this same platform, so a standalone site
	     can never replicate them regardless of its own budget. -->
	<h2 class="mt-14 text-2xl font-bold text-heading">Vote KE vs a Private Campaign Platform</h2>
	<p class="mt-2 max-w-3xl text-sm text-muted">
		A private site is only ever your own page. These need other leaders on the platform too, so no
		standalone campaign site can offer them, no matter its budget.
	</p>
	<div class="mt-6 overflow-x-auto rounded-2xl border border-border">
		<table class="w-full min-w-160 table-fixed border-collapse text-left">
			<thead>
				<tr class="bg-surface-2">
					<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading">Feature</th>
					<th class="w-3/5 px-4 py-3 text-sm font-semibold text-heading">Description</th>
					<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading">Available</th>
				</tr>
			</thead>
			<tbody>
				{#each networkFeatures as row (row.feature)}
					<tr class="border-t border-border">
						<th class="px-4 py-3 text-sm font-medium text-heading">
							{#if row.href}
								<a href={row.href} class="hover:underline">{row.feature}</a>
							{:else}
								{row.feature}
							{/if}
						</th>
						<td class="px-4 py-3 text-sm text-muted">{row.description}</td>
						<td
							class="px-4 py-3 text-sm {row.available === '✓'
								? 'font-semibold text-primary'
								: 'text-heading'}"
						>
							{row.available}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- PAYG credits: what a credit buys, once the plan's included allowance runs out. -->
	<h2 class="mt-14 text-2xl font-bold text-heading">PAYG Credits</h2>
	<p class="mt-2 text-sm text-muted">
		The cost of sending a message on various channels. Top up whenever you run out (pay-as-you-go).
	</p>
	<div class="mt-6 overflow-x-auto rounded-2xl border border-border">
		<table class="w-full min-w-160 table-fixed border-collapse text-left">
			<thead>
				<tr class="bg-surface-2">
					<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading">Item</th>
					<th class="w-1/5 px-4 py-3 text-sm font-semibold text-heading">Price</th>
					<th class="w-3/5 px-4 py-3 text-sm font-semibold text-heading">Description</th>
				</tr>
			</thead>
			<tbody>
				{#each paygCredits as row (row.item)}
					<tr class="border-t border-border">
						<th class="px-4 py-3 text-sm font-medium text-heading">{row.item}</th>
						<td class="px-4 py-3 text-sm font-semibold text-primary">{row.price}</td>
						<td class="px-4 py-3 text-sm text-muted">{row.description}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- CTA -->
	<div
		class="mt-12 flex flex-col items-center gap-4 rounded-3xl border border-primary px-6 py-10 text-center text-heading"
	>
		<p class="mt-2 text-lg font-semibold uppercase tracking-widest text-heading">
			T MINUS 10TH August 2027
		</p>

		<div class="mt-2 mx-auto">
			<Countdown />
		</div>

		<a
			href="/onboard/profile"
			class="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-on-primary transition hover:brightness-95 focus:ring-0 focus:ring-ring focus:outline-none"
		>
			🚀 Lets Get Onboard
		</a>
	</div>
</section>
