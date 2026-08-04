<script lang="ts">
	import { tooltip } from '$lib/effects';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChatThread, { signalTyping } from '$lib/components/ChatThread.svelte';
	import VerifiedIcon from './svgs/VerifiedIcon.svelte';
	import { enhance } from '$app/forms';
	import Reviews from '$lib/components/Reviews.svelte';
	import FollowButton from '$lib/components/FollowButton.svelte';
	import PledgeButton from '$lib/components/PledgeButton.svelte';
	import { renderRichText } from '$lib/utils/richtext';
	import { seatPath } from '$lib/utils/seat';
	import PencilIcon from './svgs/PencilIcon.svelte';

	// The /[leader]/[year] campaign page body, also used slugless at
	// /previews/[userId]/[year] before an admin approval mints a slug. Every run is
	// public and interactive regardless — leader.verified is a "Verified" badge
	// only (see docs/URLDiscovery.md), never a gate on follow/donate/ask.
	let { data, form }: { data: any; form?: any } = $props();
	const leader = $derived(data.leader);

	const fmt = new Intl.NumberFormat('en-KE');
	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const seat = $derived(seatPath(leader.positionTitle, leader.regionLabel));

	let asking = $state(false);

	const progress = $derived(
		data.fundraising.goal > 0
			? Math.min(100, Math.round((data.fundraising.raised / data.fundraising.goal) * 100))
			: 0
	);

	const deliveryLabel: Record<string, string> = {
		promised: 'Promised',
		in_progress: 'In progress',
		delivered: 'Delivered'
	};
</script>

<section class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
	<!-- Breadcrumb: leader / year -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<nav class="text-sm text-muted" aria-label="Breadcrumb">
			<a href={data.recordPath} class="hover:text-heading hover:underline">{leader.name}</a>
			<span class="mx-1">/</span>
			<span>{data.year}</span>
		</nav>
		{#if data.canEdit}
			<a
				href="/dashboard/{data.leaderSlug}/campaign"
				class="flex items-center gap-2 rounded-full border border-primary px-3 py-2 text-xs text-primary font-semibold transition hover:bg-primary hover:text-heading"
			>
				<PencilIcon /> <span>Manage</span>
			</a>
		{/if}
	</div>

	<div class="mt-6 grid gap-6 lg:grid-cols-3">
		<div class="lg:col-span-2">
			<!-- Candidate card -->
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
							{leader.campaignTitle || leader.name}
							{#if leader.verified}
								<span
									use:tooltip={"An admin has manually confirmed this candidacy's IEBC certificate (see docs/URLDiscovery.md)."}
									class="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-on-primary"
								>
									<VerifiedIcon />
									Verified
								</span>
							{:else}
								<span
									use:tooltip={'No IEBC certificate on file yet — the campaign is still public and fully interactive.'}
									class="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted"
								>
									Unverified
								</span>
							{/if}
						</h1>
						<p class="mt-1 text-base text-muted">
							Vying for
							{#if seat}
								<a href={seat} class="text-primary hover:text-heading hover:underline"
									>{leader.positionTitle}, {leader.regionLabel}</a
								>
							{:else}
								{leader.positionTitle}, {leader.regionLabel}
							{/if}
							for {data.year}
							{#if leader.party}
								· <a href={leader.partyPath ?? '/parties'} class="hover:text-primary hover:underline">{leader.party}</a>
							{/if}
						</p>
						<div class="mt-2 flex flex-col sm:flex-row text-center justify-between text-sm">
							<p class="font-medium text-heading">
								{fmt.format(leader.followers)} followers · {fmt.format(data.pledgeCount)} vote pledges
							</p>
						</div>
					</div>
				</div>

				{#if leader.campaignDescription}
					<!-- Stored as markdown-lite (RichTextEditor); renderRichText escapes it
					before formatting, so {@html} is safe here. -->
					<div class="mt-6 space-y-2 leading-relaxed text-lg">
						{@html renderRichText(leader.campaignDescription)}
					</div>
				{/if}
			</div>

			<!-- Manifesto with public delivery tracker -->
			<div class="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
				<h2 class="text-xl font-bold text-heading">Manifesto</h2>
				{#if leader.pillars.length > 0}
					<p class="mt-1 text-sm text-muted">
						{leader.pillars.length} pillar{leader.pillars.length === 1 ? '' : 's'}, each with a
						public delivery status
					</p>
					<ol class="mt-5 space-y-4">
						{#each leader.pillars as pillar, i (pillar.title)}
							<li class="rounded-2xl bg-surface-2 p-5">
								<div class="flex items-start gap-3">
									<span
										class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary"
									>
										{i + 1}
									</span>
									<div class="w-full">
										<h3 class="flex flex-wrap items-center gap-2 font-semibold text-heading">
											{pillar.title}
											<span
												class="rounded-full px-2 py-0.5 text-xs font-semibold {pillar.deliveryStatus ===
												'delivered'
													? 'bg-primary text-on-primary'
													: pillar.deliveryStatus === 'in_progress'
														? 'bg-primary-soft text-on-primary'
														: 'border border-border bg-surface text-muted'}"
											>
												{deliveryLabel[pillar.deliveryStatus] ?? 'Promised'}
											</span>
										</h3>
										<p class="mt-1 text-sm leading-relaxed">{pillar.summary}</p>
										{#if pillar.evidence}
											<p class="mt-1 text-xs font-medium text-primary">
												Evidence: {pillar.evidence}
											</p>
										{/if}
									</div>
								</div>
							</li>
						{/each}
					</ol>
				{:else}
					<p class="mt-3 text-sm text-muted">No manifesto published yet.</p>
				{/if}
			</div>

			<!-- Updates: the campaign's public channel feed -->
			<div class="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
				<h2 class="text-xl font-bold text-heading">Updates</h2>
				{#if data.posts.length > 0}
					<div class="mt-5 space-y-5">
						{#each data.posts as post (post.id)}
							<article class="border-b border-border pb-5 last:border-b-0 last:pb-0">
								<div class="flex flex-wrap items-baseline justify-between gap-2">
									<h3 class="font-semibold text-heading">{post.title}</h3>
									<span class="text-xs text-muted">{dateFmt.format(new Date(post.createdAt))}</span>
								</div>
								<p class="mt-2 text-sm leading-relaxed whitespace-pre-line">{post.body}</p>
							</article>
						{/each}
					</div>
				{:else}
					<p class="mt-3 text-sm text-muted">
						No public updates yet. Follow the campaign to hear first.
					</p>
				{/if}
			</div>

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
		</div>

		<!-- Sidebar -->
		<div class="space-y-6">
			<div class="rounded-3xl border border-border bg-surface p-6 flex flex-col gap-3">
				<h2 class="text-sm font-semibold tracking-wide text-muted uppercase">
					{data.currentPosition ? data.currentPosition : leader.name}
				</h2>
				<a
					href={data.recordPath}
					class="block w-full border border-primary rounded-full px-4 py-2 text-lg text-primary text-center font-semibold transition hover:brightness-95 disabled:opacity-60"
				>
					Visit the Full Profile
				</a>
			</div>

			<!-- Ask the campaign (AI) -->
			<div class="rounded-3xl border border-border bg-surface p-6">
				<h2 class="text-lg font-bold text-heading">Ask {leader.name.split(' ')[0]}</h2>
				<p class="mt-1 text-sm text-muted">
					Answers come from the manifesto and public updates, instantly.
				</p>
				<!-- The whole persisted thread (data.chatThread reloads after each ask
				via enhance's update()), not just the last form result — history
				survives refreshes and team replies show up here. -->
				<ChatThread
					messages={data.chatThread?.messages ?? []}
					awaitingReply={data.chatThread?.awaitingReply ?? false}
					leaderFirstName={leader.name.split(' ')[0]}
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

			<!-- Pledge: a signed-in promise of a 2027 vote to this run. -->
			{#if data.campaignId}
				<div class="rounded-3xl border border-border bg-surface p-6">
					<h2 class="text-lg font-bold text-heading">Pledge Your Vote</h2>
					<p class="mt-1 text-sm text-muted">
						Promise your 2027 vote to {leader.name.split(' ')[0]}.
					</p>
					<div class="mt-4">
						<PledgeButton
							campaignId={data.campaignId}
							candidateName={leader.name}
							isPledged={data.isPledged}
							signedIn={data.signedIn}
							wide
						/>
					</div>
				</div>
			{/if}

			<!-- Follow -->
			<FollowButton
				candidateName={leader.name}
				signedIn={data.signedIn}
				isFollowing={data.isFollowing}
			/>

			<!-- Fundraising: the goal + donate form show only when the campaign has set
			a goal. Without one, the candidate isn't fundraising, so the box says so
			instead of showing an empty "raised of KES 0". -->
			<div class="rounded-3xl border border-border bg-surface p-6">
				<h2 class="text-lg font-bold text-heading">Fund the campaign</h2>
				{#if data.fundraising.goal > 0}
					<p class="mt-2 text-sm">
						<span class="font-bold text-heading">KES {fmt.format(data.fundraising.raised)}</span>
						<span class="text-muted">
							of KES {fmt.format(data.fundraising.goal)} ({progress}%)</span
						>
					</p>
					<div class="mt-2 h-3 overflow-hidden rounded-full bg-surface-2">
						<div class="h-full rounded-full bg-primary" style="width: {progress}%"></div>
					</div>

					{#if form?.donated}
						<div class="mt-3 rounded-2xl bg-primary-soft p-4 text-sm font-medium text-on-primary">
							{#if form.stk}
								Asante! Check your phone and enter your M-Pesa PIN to complete the KES
								{fmt.format(form.amount)} donation.
							{:else}
								Asante! Send KES {fmt.format(form.amount)} via M-Pesa to the campaign's till and the team
								will confirm it.
							{/if}
						</div>
					{:else}
						<form method="post" action="?/donate" class="mt-3 space-y-2" use:enhance>
							<div class="flex gap-2">
								<input
									type="text"
									name="donorName"
									required
									value={data.viewerProfile?.name ?? ''}
									placeholder="Your name"
									class="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
								/>
								<input
									type="text"
									name="phone"
									value={data.viewerProfile?.phone ?? ''}
									placeholder="M-Pesa phone (optional)"
									class="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
								/>
							</div>
							<div class="flex items-center gap-2">
								<span class="flex-1">Amount, KES</span>
								<input
									type="number"
									name="amount"
									required
									min="10"
									placeholder="KES"
									class="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
								/>
							</div>
							<button
								type="submit"
								class="w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
							>
								Donate
							</button>
							<p class="text-xs leading-relaxed text-muted">
								With your M-Pesa phone, you get a payment prompt on your handset; without it, the
								campaign team confirms your pledge once received. A 5% platform fee applies - see
								the
								<a href="/fundraising" class="underline hover:text-heading">fundraising rules</a>.
							</p>
						</form>
					{/if}
				{:else}
					<p class="mt-2 text-xs text-muted">
						{leader.name} is not fundraising for this campaign.
					</p>
				{/if}
			</div>
		</div>
	</div>
</section>
