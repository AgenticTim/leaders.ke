<script lang="ts">
	import { tooltip } from '$lib/effects';
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChatThread, { signalTyping } from '$lib/components/ChatThread.svelte';
	import SeatJD from '$lib/components/jd/SeatJD.svelte';
	import DeliveryScore from '$lib/components/DeliveryScore.svelte';
	import ExperienceBlock from '$lib/components/ExperienceBlock.svelte';
	import Reviews from '$lib/components/Reviews.svelte';
	import ContactLinks from '$lib/components/contact/ContactLinks.svelte';
	import FollowButton from '$lib/components/FollowButton.svelte';
	import PledgeButton from '$lib/components/PledgeButton.svelte';
	import { renderRichText } from '$lib/utils/richtext';
	import { isRunStatus } from '$lib/utils/seat';
	import PencilIcon from './svgs/PencilIcon.svelte';

	// The public /[leader] page body, shared with two admin preview contexts
	// (a pending application, a pending claim) via `preview`, same look citizens
	// will eventually see, so what an admin approves is what actually ships.
	// In preview mode: "Manage", "Latest News", Reviews, Ask, and the claim/managed
	// cards are all hidden (nothing meant only for a live, public profile); the
	// campaign link and everything else render the same either way.

	let {
		data,
		form = undefined,
		preview = false
	}: {
		data: any;
		form?: any;
		preview?: boolean;
	} = $props();

	const leader = $derived(data.leader);
	// Derived, not a one-shot const: client-side navigation between leader pages
	// reuses this component, so a plain const would keep the previous leader's
	// name in the Ask heading and team labels.
	const firstName = $derived(leader.name.split(' ')[0]);

	// A run-only person (candidate/aspirant) doesn't currently hold ANY electoral
	// seat, so there's no accurate "Current X" to state. The whole card (heading +
	// contestants link) is dropped rather than showing a misleading title (e.g.
	// their own candidacy).
	const currentRole = $derived(
		isRunStatus(leader.status)
			? null
			: { title: data.breadcrumb.positionTitle, institution: data.breadcrumb.regionLabel }
	);

	const fmt = new Intl.NumberFormat('en-KE');
	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	// ContactLinks wants a bare phone number (for the wa.me link) and a plain email
	// address; data.contacts carries them as verifiable channel rows instead.
	const contactPhone = $derived(
		data.contacts.find((c: { channel: string }) => c.channel === 'sms' || c.channel === 'whatsapp')
			?.value ?? null
	);
	const contactEmail = $derived(
		data.contacts.find((c: { channel: string }) => c.channel === 'email')?.value ?? null
	);

	// Ask the leader (AI): same feature as the campaign workspace's Ask block,
	// grounded in the same manifesto/posts via this page's own ?/ask action.
	let asking = $state(false);
</script>

<section class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
	<!-- Breadcrumb: current campaign's seat if vying, else last held seat -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<nav class="text-sm text-muted" aria-label="Breadcrumb">
			<a href={data.breadcrumb.positionPath} class="hover:text-heading hover:underline">
				{data.breadcrumb.positionTitle}
			</a>
			{#if data.breadcrumb.regionLabel}
				<span class="mx-1">/</span>
				<a href={data.breadcrumb.seatPath} class="hover:text-heading hover:underline">
					{data.breadcrumb.regionLabel}
				</a>
			{/if}
			<span class="mx-1">/</span>
			<span>{leader.name}</span>
		</nav>
		{#if !preview && data.canEdit}
			<a
				href="/dashboard/{leader.slug}/profile"
				class="flex items-center gap-2 rounded-full border border-primary px-3 py-2 text-xs text-primary font-semibold transition hover:bg-primary hover:text-heading"
			>
				<PencilIcon /> <span>Manage</span>
			</a>
		{/if}
	</div>

	<div class="mt-6 grid gap-6 lg:grid-cols-3">
		<div class="lg:col-span-2">
			<!-- Identity card -->
			<div class="rounded-3xl border border-border bg-surface p-6 sm:p-8">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-center">
					<Avatar
						name={leader.name}
						initials={leader.initials}
						photoUrl={leader.photoUrl}
						sizeClass="size-30"
						textClass="text-4xl"
					/>
					<div class="w-full">
						<h1
							class="flex flex-wrap items-center gap-2 text-2xl font-extrabold text-heading sm:text-3xl"
						>
							{leader.name}
							<!-- A badge only: every profile is public regardless (see docs/URLDiscovery.md). -->
							<span
								use:tooltip={'An admin has manually confirmed the facts on this seat/candidacy (see docs/URLDiscovery.md)'}
								class="inline-flex items-center gap-1 rounded-full {leader.verified
									? 'bg-primary-soft text-on-primary'
									: 'bg-surface-3 text-on-mute'} px-2.5 py-1 text-xs font-semibold"
							>
								<span>{leader.verified ? '✓' : '✗'}</span>
								<span>{leader.verified ? 'Verified' : 'Unverified'}</span>
							</span>
						</h1>
						<p class="mt-1 text-sm text-muted">
							<!-- A campaign-less run-only person (fresh profile) gets a "Create a
							campaign" prompt instead of a bare status label, linked into the
							dashboard Campaign tab when the viewer can edit this profile. -->
							{#if isRunStatus(leader.status) && !data.campaign}
								{#if data.canEdit && leader.slug}
									<a href="/dashboard/{leader.slug}/campaign" class="font-medium text-primary hover:underline">Create a campaign</a>
								{:else}
									<span>Create a campaign</span>
								{/if}
							{:else}
								<span class="capitalize">{leader.status}</span>
							{/if}
							·
							<a href={data.breadcrumb.seatPath} class="hover:text-primary">
								{leader.positionTitle}, {leader.regionLabel}
							</a>
							{#if leader.party}
								· <a href={leader.partyPath ?? '/parties'} class="hover:text-primary hover:underline">{leader.party}</a>
							{/if}
						</p>

						<div class="mt-2 flex flex-col sm:flex-row text-center justify-between text-sm">
							<p class="font-medium text-heading">
								{fmt.format(leader.followers)} followers · {fmt.format(data.pledgeCount)} vote pledges
								<!-- Constitutional job description for this seat, in a modal. -->
								· <SeatJD title={leader.positionTitle} triggerClass="text-sm text-primary hover:underline" />
							</p>
						</div>
					</div>
				</div>

				{#if leader.bio}
					<!-- Bio is stored as markdown-lite (RichTextEditor); renderRichText
					escapes it before formatting, so {@html} is safe here. -->
					<div class="mt-6 space-y-2 leading-normal text-lg">
						{@html renderRichText(leader.bio)}
					</div>
				{/if}
			</div>

			<!-- Delivery score: public rollup of the manifesto tracker -->
			{#if data.delivery.total > 0}
				<div class="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
					<DeliveryScore
						delivered={data.delivery.delivered}
						total={data.delivery.total}
						inProgress={data.delivery.inProgress}
					/>
				</div>
			{/if}

			<!-- Education + professional experience -->
			{#if data.experience.education.length > 0 || data.experience.professional.length > 0}
				<div class="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
					<h2 class="text-xl font-bold text-heading">Experience</h2>
					{#if data.experience.professional.length > 0}
						<h3 class="mt-5 text-xs font-semibold tracking-wide text-muted uppercase">
							Professional
						</h3>
						<ul class="mt-4 space-y-3">
							{#each data.experience.professional as item, i (i)}
								<ExperienceBlock
									title={item.title}
									subtitle={item.institution}
									href={item.href}
									description={item.description}
									dateLabel={isRunStatus(item.badge)
										? `Vying · from ${item.from}`
										: item.from
											? item.to === item.from
												? `${item.from}`
												: `${item.from}${item.to ? `-${item.to}` : ', present'}`
											: ''}
									badge={item.badge}
									badgeClass={item.badge === 'current'
										? 'bg-primary-soft text-on-primary'
										: 'bg-surface text-muted'}
								/>
							{/each}
						</ul>
					{/if}
					{#if data.experience.education.length > 0}
						<h3 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">Education</h3>
						<ul class="mt-3 space-y-3">
							{#each data.experience.education as item, i (i)}
								<ExperienceBlock
									title={item.title}
									subtitle={item.institution}
									description={item.description}
									dateLabel={item.from ? `${item.from}${item.to ? `-${item.to}` : ''}` : ''}
								/>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}

			{#if !preview}
				<!-- Latest News: the newest few pieces of coverage tagged to this
				leader, with "More news" opening the full feed filtered to them. -->
				{#if data.news.length > 0}
					<div class="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
						<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
							<h2 class="text-xl font-bold text-heading">Latest News</h2>
							{#if leader.slug}
								<a href="/?mention={leader.slug}" class="text-sm font-semibold text-primary hover:underline">
									More news about {leader.name.split(' ')[0]} →
								</a>
							{/if}
						</div>
						<p class="mt-1 text-sm text-muted">
							Latest 5 pieces mentioning {leader.name}, from verified media, tagged automatically.
						</p>
						<div class="mt-5 space-y-4">
							{#each data.news as item (item.id)}
								<article class="border-b border-border pb-4 last:border-b-0 last:pb-0">
									<div class="flex flex-wrap items-baseline justify-between gap-2">
										<h3 class="text-sm font-semibold text-heading">{item.title}</h3>
										<span class="text-xs text-muted"
											>{dateFmt.format(new Date(item.createdAt))}</span
										>
									</div>
									<p class="mt-1 text-sm leading-relaxed text-muted">{item.summary}</p>
								</article>
							{/each}
						</div>
					</div>
				{/if}
				<!-- Citizen reviews -->
				<Reviews
					leaderName={leader.name}
					positionTitle={leader.positionTitle}
					reviews={data.reviews}
					pillarOptions={data.reviewPillarOptions}
					signedIn={data.signedIn}
					flaggedReviewCounts={data.flaggedReviewCounts}
					myReview={data.myReview}
					{form}
				/>
			{/if}
		</div>

		<!-- Sidebar: Ask, contact, claim status, seat links -->
		<div class="space-y-6">
			{#if data.isVying}
				<div class="rounded-3xl border border-border bg-surface p-6 flex flex-col gap-3">
					<!-- isVying only means "not a former officeholder", so a sitting leader
					with no campaign row reaches here with data.campaign null. Every read
					is optional; the seat falls back to the one they hold. -->
					<h2 class="text-sm font-semibold tracking-wide text-muted uppercase">
						Running for {data.campaign?.positionTitle ?? leader.positionTitle}{(data.campaign?.regionLabel ??
							leader.regionLabel) &&
						(data.campaign?.regionLabel ?? leader.regionLabel) !== 'Kenya'
							? `, ${data.campaign?.regionLabel ?? leader.regionLabel}`
							: ''} in {data.campaign?.year ?? 2027}
					</h2>
					{#if data.campaign?.positionTitle}
						<a
							href={data.campaign.path}
							class="block w-full border border-primary rounded-full px-4 py-2 text-lg text-primary text-center font-semibold transition hover:brightness-95 disabled:opacity-60"
						>
							Visit the Campaign Page
						</a>
					{:else}
						<p
							class="block w-full border border-border rounded-full px-4 py-2 text-lg text-muted text-center font-semibold"
						>
							No Campaign Listed
						</p>
					{/if}
				</div>
			{/if}

			{#if !preview}
				<!-- Ask the leader (AI) -->
				<div class="rounded-3xl border border-border bg-surface p-6">
					<h2 class="text-lg font-bold text-heading">Ask {firstName}</h2>
					<p class="mt-1 text-sm text-muted">
						Answers come from the manifesto and public updates, instantly.
					</p>
					<!-- The whole persisted thread (data.chatThread reloads after each ask
					via enhance's update()), not just the last form result, history
					survives refreshes and team replies show up here. -->
					<ChatThread
						messages={data.chatThread?.messages ?? []}
						awaitingReply={data.chatThread?.awaitingReply ?? false}
						leaderFirstName={firstName}
						personId={data.subjectId}
					/>
					{#if form?.error}
						<div
							class="mt-3 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading"
						>
							{form.error}
						</div>
					{/if}
					<form
						method="post"
						action="?/ask"
						class="mt-3 space-y-2"
						use:enhance={() => {
							asking = true;
							return async ({ update }) => {
								asking = false;
								await update();
							};
						}}
					>
						<textarea
							name="question"
							rows="2"
							required
							maxlength={data.askMaxChars}
							placeholder="e.g. What is the plan for water in my ward?"
							oninput={() => signalTyping(data.subjectId)}
							onkeydown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									e.currentTarget.form?.requestSubmit();
								}
							}}
							class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
						></textarea>
						<button
							type="submit"
							disabled={asking}
							class="w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
						>
							{asking ? 'Thinking…' : 'Ask'}
						</button>
					</form>
				</div>
			{/if}

			{#if currentRole}
				<div class="rounded-3xl border border-border bg-surface p-6">
					<h2 class="text-sm font-semibold tracking-wide text-muted uppercase">
						Current {currentRole.title}{#if currentRole.institution}, {currentRole.institution}{/if}
					</h2>
					{#if data.numContestants > 0}
						<ul class="mt-3 space-y-2 text-sm">
							<li>
								<a
									href="{data.breadcrumb.seatCyclePath}/2027"
									class="font-medium text-heading hover:text-primary"
								>
									🗳️ {data.numContestants} contestants for 2027 →
								</a>
							</li>
						</ul>
					{/if}
				</div>
			{/if}

			<!-- Pledge: a signed-in promise of a 2027 vote to this person's active run. -->
			{#if !preview && data.leadCampaignId}
				<div class="rounded-3xl border border-border bg-surface p-6">
					<h2 class="text-lg font-bold text-heading">Pledge Your Vote</h2>
					<p class="mt-1 text-sm text-muted">
						Promise your 2027 vote to {leader.name.split(' ')[0]}.
					</p>
					<div class="mt-4">
						<PledgeButton
							campaignId={data.leadCampaignId}
							candidateName={leader.name}
							isPledged={data.isPledged}
							signedIn={data.signedIn}
							wide
						/>
					</div>
				</div>
			{/if}

			<FollowButton
				candidateName={leader.name}
				signedIn={data.signedIn}
				isFollowing={data.isFollowing}
			/>

			{#if data.contacts.length > 0 || leader.address || Object.keys(leader.socials).length > 0}
				<div class="rounded-3xl border border-border bg-surface p-6">
					<h2 class="text-sm font-semibold tracking-wide text-muted uppercase">Contact</h2>
					<div class="mt-4">
						<ContactLinks
							phone={contactPhone}
							email={contactEmail}
							socials={leader.socials}
							share={!preview}
							shareTitle={leader.name}
						/>
					</div>
					{#if leader.address}
						<p class="mt-3 space-y-2 text-sm">
							{leader.address}
						</p>
					{/if}
				</div>
			{/if}

			{#if data.deliveryGroups.length > 0}
				<div class="rounded-3xl border border-border bg-surface-2 p-6">
					<h2 class="text-sm font-semibold tracking-wide text-muted uppercase">Delivered</h2>
					<div class="mt-3 space-y-4">
						{#each data.deliveryGroups as group (group.label)}
							<div>
								<p class="text-xs font-semibold text-heading">
									{group.label}
									<span class="font-normal text-muted">({group.from} to {group.to ?? 'present'})</span>
								</p>
								<ol class="mt-1.5 space-y-2 text-sm">
									{#each group.items as item, i (i)}
										<li class="flex gap-2 text-muted">
											<span class="shrink-0 font-semibold text-heading">{i + 1}.</span>
											<span>
												<span class="text-heading">{item.title}</span>
												{#if item.description}<span class="block text-muted"
														>{item.description}</span
													>{/if}
											</span>
										</li>
									{/each}
								</ol>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if !preview && data.canClaim}
				<div class="rounded-3xl bg-primary p-6 text-on-primary">
					<h2 class="text-lg font-bold text-on-primary">Managing {firstName}?</h2>
					<p class="mt-2 text-sm text-on-primary/80">Get access to modify this page.</p>
					<a
						href="/onboard/profile?profile={leader.slug}"
						class="mt-4 inline-block rounded-full bg-surface px-5 py-2.5 text-sm font-semibold text-heading transition hover:bg-surface-2"
					>
						Claim this profile
					</a>
				</div>
			{:else if !preview && data.isManaged}
				<div class="rounded-3xl border border-border bg-surface-2 p-6">
					<h2 class="text-lg font-bold text-heading">Claimed &amp; Managed</h2>
					<p class="mt-2 text-sm text-muted">
						<a href="/contact-us" class="font-medium text-primary hover:underline">Contact us</a> if this
						is a mistake.
					</p>
				</div>
			{/if}
		</div>
	</div>
</section>
