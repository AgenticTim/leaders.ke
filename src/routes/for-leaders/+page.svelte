<script lang="ts">
	import Countdown from '$lib/components/Countdown.svelte';
	import type { PageData } from './$types';
	import SloganCycler from '$lib/components/SloganCycler.svelte';
	import WordCycler from '$lib/components/WordCycler.svelte';

	// This page sells to the paying customer (candidates and currents); the
	// homepage itself is the citizen voting booth.

	// The hero headline is two cycling halves: any left word reads naturally with
	// any right word, so the pairs don't need to line up.
	const leftSet = ['Leadership', 'Campaign', 'Publicity'];
	const rightSet = ['Launchpad', 'Copilot', 'Panel'];


	// Campaign toolkit grid: what a subscription buys. `live` distinguishes
	// shipped features from roadmap items (badged "Coming soon") — the badge
	// doubles as a demand test for later phases.
	// Ordered by what sells; one-clause descriptions keep the section scannable.
	// Featured placement is pipeline (see FAQ), so it sits last and badged.
	const toolkit = [
		{
			title: 'Verified profile',
			description: 'Citizens trust verified candidature and profiles with a track record.',
			live: true,
			icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
		},
		{
			title: 'Followers & broadcasts',
			description: 'Reach supporters by ward via email, SMS and WhatsApp.',
			live: true,
			icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Z'
		},
		{
			title: 'AI chat & competitor watch',
			description: 'AI answers citizens from your manifesto and tracks your rivals.',
			live: true,
			icon: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z'
		},
		{
			title: 'AI PR desk',
			description: 'Be notified when mentioned in news and get AI draft responses.',
			live: true,
			icon: 'M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5'
		},
		{
			title: 'Pledges & Fundraising',
			description: 'Let citizens pledge to vote for you and donate to your campaign!',
			live: true,
			icon: 'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
		},
		{
			title: 'Featured placement',
			description: 'Your profile pinned for every voter browsing the directory.',
			live: false,
			icon: 'M11.48 3.5a.562.562 0 0 1 1.04 0l2.12 5.11 5.52.44c.5.04.7.66.32.99l-4.2 3.6 1.28 5.38a.562.562 0 0 1-.84.61L12 16.72l-4.72 2.91a.562.562 0 0 1-.84-.61l1.28-5.38-4.2-3.6a.562.562 0 0 1 .32-.99l5.52-.44 2.12-5.11Z'
		}
	];

	// Mirrors the real /onboard wizard (profile -> plan -> checkout), then the
	// post-payment verification that takes the page public.
	const steps = [
		{
			title: 'Claim your profile',
			description:
				'If your page is already listed, claim it; otherwise create it fresh.'
		},
		{
			title: 'Pick your plan',
			description: 'Three packages, one flat rate for every office, MCA to President.'
		},
		{
			title: 'Pay via M-Pesa or Bank',
			description: 'Activate your subscription and unlock your campaign dashboard.'
		},
		{
			title: 'Get verified & go public',
			description:
				'Complete your profile for your page to get a verified badge.'
		}
	];

	// Placeholder quotes until Phase 4 delivers real case studies.
	const testimonials = [
		{
			quote:
				'My constituents finally have one place to read my manifesto instead of screenshots on WhatsApp.',
			name: 'Verified aspirant',
			role: 'MCA candidate, Rift Valley'
		},
		{
			quote:
				'The verification badge settled the fake-accounts problem in one week. We point everyone to the page.',
			name: 'Campaign manager',
			role: 'Gubernatorial campaign, Coast'
		},
		{
			quote: 'We treat the profile link like our digital office. It goes on every poster we print.',
			name: 'Communications lead',
			role: 'Senatorial campaign, Nairobi'
		}
	];

	let { data }: { data: PageData } = $props();

	// Live counts from the load function — never hand-maintained numbers a
	// campaign team could catch out of date.
	const fmt = new Intl.NumberFormat('en-KE');
	const stats = $derived([
		{ value: fmt.format(data.positionCount), label: 'Elective positions' },
		{ value: fmt.format(data.profileCount), label: 'Leader profiles' },
		{ value: fmt.format(data.campaignCount), label: '2027 campaigns' }
	]);
</script>

<svelte:head>
	<title>vote.ke for Leaders — Your 2027 Campaign HQ</title>
	<meta
		name="description"
		content="Run and win your 2027 campaign from one platform: a verified profile, manifesto, followers and broadcasts. Citizens: verify who is vying and follow campaigns."
	/>
</svelte:head>

<!-- Hero: speaks to the candidate; the countdown card keeps election urgency front and center -->
<section class="relative overflow-hidden">
	<div
		class="pointer-events-none absolute inset-0 bg-linear-to-b from-primary-soft/40 to-transparent"
	></div>
	<div class="relative mx-auto grid max-w-7xl gap-5 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
		<div class="flex flex-col justify-center max-w-xl">
			<span
				class="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-on-primary"
			>
				<span class="size-2 rounded-full bg-primary"></span>
				Your voters are already here.
			</span>
			<!-- Two halves of the headline cycle independently, staggered so only one
			word swaps at a time (e.g. "Campaign Machinery" → "Campaign Dashboard"). -->
			<h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight text-heading">
				<WordCycler words={leftSet} />
				<WordCycler words={rightSet} delay={1000} />
			</h1>
			<p class="mt-8 sm:mt-12 text-base sm:text-lg leading-relaxed">
				Citizens are practising their 2027 vote on this site right now. 
				Get a verified page they can trust, and access tools that turn visitors into followers, pledges, and votes.
				<span class="font-semibold">
					Be the name they recognize.
				</span>
			</p>
			<!-- Primary action first; a single secondary keeps attention on claiming. -->
			<div class="mt-8 sm:mt-12 flex flex-wrap gap-2 sm:gap-3">
				<a
					href="/onboard/profile"
					class="rounded-full bg-primary px-4 py-3 sm:px-6 sm:py-3 font-semibold text-on-primary transition hover:brightness-95 focus:ring-0 focus:ring-ring focus:outline-none"
				>
					🚀 Claim your page
				</a>
				<a
					href="/pricing"
					class="rounded-full border border-border bg-surface px-4 py-3 sm:px-6 sm:py-3 font-semibold text-heading transition hover:bg-surface-2"
				>
					<span class="hidden sm:inline">Pricing from KES 2,500/mo</span>
					<span class="inline sm:hidden">From 2,500/mo</span>
				</a>
			</div>
		</div>

		<!-- Countdown card -->
		<div class="flex items-center justify-center">
			<div
				class="my-6 w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-sm"
			>
				<p class="text-sm font-medium tracking-wide text-muted uppercase">Countdown to the vote</p>
				<div class="mx-auto my-6">
					<Countdown />
				</div>

				<p class="mt-2 text-xl font-semibold tracking-widest text-heading uppercase">
					10 August 2027
				</p>

				<div class="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-6">
					{#each stats as stat (stat.label)}
						<div>
							<p class="text-xl font-bold text-primary">{stat.value}</p>
							<p class="text-xs text-muted">{stat.label}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</section>

<!-- Campaign toolkit: the feature grid a subscription buys -->
<section class="border-t border-border bg-surface-2">
	<div class="mx-auto max-w-7xl px-4 py-14 sm:px-6">
		<div class="mb-8 ">
			<h2 class="text-2xl font-bold text-heading">Everything a campaign needs</h2>
			<p class="mt-1 text-sm text-muted">
				One subscription runs your entire public presence, whether you are defending a seat or
				gunning for one.
			</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each toolkit as feature (feature.title)}
				<!-- Big icon alone on the left; title with description stacked beside it,
				left-aligned to each other. -->
				<div class="flex items-start gap-4 rounded-2xl border border-border bg-surface p-6">
					<span class="grid size-20 shrink-0 place-items-center rounded-xl bg-primary-soft text-on-primary">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							class="size-12"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d={feature.icon} />
						</svg>
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<h3 class="text-lg font-semibold text-heading">{feature.title}</h3>
						</div>
						<p class="mt-1 text-sm leading-relaxed">{feature.description}</p>
					</div>
				</div>
			{/each}
		</div>

		<div class="mt-8 text-center">
			<a href="/features" class="text-sm font-semibold text-primary hover:underline">
				See the full feature list →
			</a>
		</div>
	</div>
</section>

<!-- How it works: the onboarding funnel -->
<section class="mx-auto max-w-7xl px-4 py-14 sm:px-6">
	<div class="mb-8 ">
		<h2 class="text-2xl font-bold text-heading">From aspirant to verified in four steps</h2>
		<p class="mt-1 text-sm text-muted">
			Campaign managers can sign up and run the whole process on a candidate's behalf.
		</p>
	</div>

	<ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each steps as step, i (step.title)}
			<li class="rounded-2xl border border-border bg-surface p-6">
				<div class="flex items-center gap-3">
					<span
						class="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-on-primary"
					>
						{i + 1}
					</span>
					<h3 class="font-semibold text-heading">{step.title}</h3>
				</div>
				<p class="mt-2 text-sm leading-relaxed">{step.description}</p>
			</li>
		{/each}
	</ol>
</section>

<!-- Social proof: placeholder quotes until real Phase 4 case studies replace them -->
<section class="border-t border-border bg-surface-2">
	<div class="mx-auto max-w-7xl px-4 py-14 sm:px-6">
		<h2 class="text-2xl font-bold text-heading">Campaigns run on vote.ke</h2>
		<div class="mt-8 grid gap-4 md:grid-cols-3">
			{#each testimonials as t (t.role)}
				<figure class="flex flex-col rounded-2xl border border-border bg-surface p-6">
					<svg viewBox="0 0 24 24" fill="currentColor" class="size-6 text-primary/40">
						<path
							d="M7.2 5.6C4.9 7.1 3.4 9.6 3.4 12.6c0 3.4 2.2 5.8 5 5.8 2.4 0 4.2-1.8 4.2-4.1 0-2.2-1.6-3.9-3.8-3.9-.4 0-.9.1-1 .1.3-1.9 2-4 3.8-5l-4.4.1Zm9.9 0c-2.3 1.5-3.8 4-3.8 7 0 3.4 2.2 5.8 5 5.8 2.3 0 4.2-1.8 4.2-4.1 0-2.2-1.7-3.9-3.9-3.9-.4 0-.8.1-1 .1.4-1.9 2.1-4 3.9-5l-4.4.1Z"
						/>
					</svg>
					<blockquote class="mt-3 flex-1 text-sm leading-relaxed">{t.quote}</blockquote>
					<figcaption class="mt-4">
						<p class="text-sm font-semibold text-heading">{t.name}</p>
						<p class="text-xs text-muted">{t.role}</p>
					</figcaption>
				</figure>
			{/each}
		</div>
	</div>
</section>

<!-- Pricing teaser + CTA -->
<section class="mx-auto max-w-7xl px-4 py-16 sm:px-6">
	<div
		class="flex flex-col items-center gap-4 rounded-3xl bg-primary px-6 py-12 text-center text-on-primary"
	>
		<h2 class="text-2xl font-bold text-on-primary sm:text-3xl">Running in 2027?</h2>
		<p class="max-w-xl text-on-primary/80">
			Claim your profile, get verified, and go public before your opponents do.
		</p>
		<div class="mt-2 flex flex-wrap justify-center gap-3">
			<a
				href="/onboard/profile"
				class="rounded-full bg-surface px-6 py-3 font-semibold text-heading transition hover:bg-surface-2"
			>
				🚀 Launch Your Campaign
			</a>
		</div>
	</div>
</section>
