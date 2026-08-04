<script lang="ts">
	import Countdown from './Countdown.svelte';

	// Site-wide footer: link directory grouped by audience (voters first), with
	// the brand blurb and the compliance line the old two-line footer carried.
	const groups = [
		{
			title: 'Voters',
			links: [
				{ href: '/', label: 'My 2027 Ballot' },
				{ href: '/education', label: 'Voter Education' },
				{ href: '/demographics', label: 'Voter Demographics' },
				{ href: '/dates', label: 'Key Dates' },
				{ href: '/drives', label: 'Registration Drives' },
				{ href: '/verify-registration', label: 'Verify Registration' }
			]
		},
		{
			title: 'Explore',
			links: [
				{ href: '/presidents', label: 'Leaders' },
				{ href: '/rank/presidents', label: 'Ranks' },
				{ href: '/compare', label: 'Compare' },
				{ href: '/parties', label: 'Parties' },
				{ href: '/news', label: 'News' }
			]
		},
		{
			title: 'Leaders',
			links: [
				{ href: '/for-leaders', label: 'Run Your Campaign' },
				{ href: '/onboard/profile', label: 'Get Onboard' },
				{ href: '/features', label: 'Features' },
				{ href: '/pricing', label: 'Pricing' },
				{ href: '/fundraising', label: 'Fundraising' },
			]
		},
		{
			title: 'Company',
			links: [
				{ href: '/about', label: 'About Us' },
				{ href: '/faq', label: 'FAQ' },
				{ href: '/contact-us', label: 'Contact Us' },
				{ href: '/privacy', label: 'Privacy Policy' },
				{ href: '/data-policy', label: 'Data Policy' },
				{ href: '/terms', label: 'Terms of Service' }
			]
		}
	];
</script>

<footer class="relative overflow-hidden border-t border-border bg-surface-2">
	<!-- @container here (not on <footer>): the giant "vote.ke" background text
	below is sized in cqw units, meant to scale against THIS box's width. With
	@container on the full-bleed <footer> instead, cqw resolved against the whole
	viewport on screens wider than max-w-7xl, making the text wider than the box
	it's actually centered in. This row's own overflow-hidden then cropped it. -->
	<div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 @container">
		<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-6">
			<!-- Brand -->
			<div class="sm:col-span-2">
				<a href="/" class="text-lg font-bold text-heading">vote.ke</a>
				<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted">
					Your 2027 voting booth: practise your ballot, know your candidates, and campaign for the
					leaders you believe in. We don't endorse candidates or parties.
				</p>
				<!-- Election countdown, capped to the blurb's width -->
				<div class="mt-4 max-w-xs text-center">
					<Countdown />
				</div>
			</div>

			{#each groups as group (group.title)}
				<nav aria-label={group.title}>
					<h2 class="text-xs font-semibold tracking-wide text-heading uppercase">{group.title}</h2>
					<ul class="mt-3 space-y-2">
						{#each group.links as link (link.label)}
							<li>
								<a href={link.href} class="text-sm text-muted transition hover:text-primary">
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</nav>
			{/each}
		</div>
		<!-- Clipped to a fixed height, top-aligned: "vote.ke" has a descender (the
		"g"), which at this size otherwise bleeds past leading-none's line box into
		the row below. Top-aligning (not centering) inside the shorter box means only
		that descender gets clipped, not the tops of the letters. -->
		<div class="-z-10 h-[32cqw] overflow-hidden mt-5 -mb-5 lg:-mt-10 lg:-mb-10">
			<p
				class="flex select-none items-start justify-center gap-[0.08em] ml-[-0.2em] text-[32cqw] font-bold leading-none tracking-tighter text-primary/20"
			>
				<span class="">vote.ke</span>
		</p>
		</div>
		<div
			class="mt-10 flex flex-col items-center justify-between gap-2 border-t border-border pt-6 text-xs text-muted sm:flex-row"
		>
			<p>© {new Date().getFullYear()} vote.ke - Know your leaders and practise your vote.</p>
			<p>Adhering to IEBC regulations &amp; the Data Protection Act (2019)</p>
		</div>
	</div>
</footer>
