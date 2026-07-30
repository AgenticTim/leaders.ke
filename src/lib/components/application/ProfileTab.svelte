<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ExperienceBlock from '$lib/components/ExperienceBlock.svelte';
	import ImageCropper from '$lib/components/ImageCropper.svelte';
	import PositionSelector from '$lib/components/PositionSelector.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { slide } from 'svelte/transition';

	// The campaign family's (/dashboard/[slug]/profile) +page.server.ts shapes
	// `data` to this contract and hosts the actions this form posts to (relative
	// ?/action URLs). The photo is staged locally (cropped, previewed) and
	// uploads WITH ?/save — nothing touches the server before "Save profile".
	type DeliveryItem = { id: number; title: string; description: string | null; pinned: boolean };
	type TabData = {
		positions: { id: number; title: string; region: string }[];
		// Absent when the Party select shouldn't render (party changes belong to
		// the verified profile's own admins).
		parties?: { id: number; name: string }[];
		photoUrl?: string | null;
		existingExperience: {
			id: number;
			type: string;
			title: string;
			institution: string;
			description?: string | null;
			from: number | null;
			to: number | null;
		}[];
		existingLeadership: {
			id: number;
			positionTitle: string;
			region: string;
			description: string | null;
			from: number;
			to: number | null;
			partyId: number | null;
			partyName: string | null;
		}[];
		// Deliveries (merged in from the old Delivery tab), keyed by target string
		// "leader:<id>" / "experience:<id>" — listed under the matching saved item.
		deliveriesByTarget?: Record<string, DeliveryItem[]>;
		pinnedCount?: number;
		maxPinned?: number;
		form: {
			firstName: string;
			otherNames: string;
			bio: string;
			positionId: number | null;
			slug: string | null;
			hasLeader: boolean;
			verified: boolean;
		};
		application?: {
			profile: { complete: boolean; missing: string[] };
			documentation?: { missing: string[] };
		} | null;
	};
	let {
		data,
		form,
		claimAttestation = false
	}: { data: TabData; form: any; claimAttestation?: boolean } = $props();

	// Claim family: auto-advance to Contacts only on the FIRST save (the one that
	// unlocks it). Captured at load so re-editing an already-complete claim (e.g.
	// after a rejection) stays put on Profile instead of being bounced away.
	const advanceOnSave = claimAttestation && !data.application?.profile.complete;

	let saving = $state(false);
	// Claim family only: a false-claim attestation gates the Save button — checked
	// server-side too (see the claim's ?/save action), this is just the live UI gate.
	let attested = $state(false);
	// Local editing state for the rich-text bio (the form posts it via name="bio").
	let bio = $state(data.form.bio);
	const missing = $derived(
		new Set((form as { missingFields?: string[] } | undefined)?.missingFields ?? [])
	);
	// Errored fields aren't outlined - the red * next to the label (starClass) and
	// the message under the save button do the flagging.
	const errorClass = () => 'border-border focus:border-primary focus:ring-ring';

	// Application checklist (from the layout load): a required-field label still in this
	// set is unfilled → its `*` stays red; once saved and out of the set, `*` goes muted.
	// A failed save's missingFields (field names, not labels) redden the same `*`.
	// The photo is part of ?/save itself now (multipart).
	const appMissing = $derived(new Set(data.application?.profile.missing ?? []));
	const docMissing = $derived(new Set(data.application?.documentation?.missing ?? []));
	const FIELD_BY_LABEL: Record<string, string> = {
		'First name': 'firstName',
		'Other names': 'otherNames',
		Bio: 'bio',
		'Elective position': 'positionId'
	};
	const starRed = (label: string) =>
		appMissing.has(label) || docMissing.has(label) || missing.has(FIELD_BY_LABEL[label] ?? '');
	const starClass = (label: string) => (starRed(label) ? 'text-red-500' : 'text-muted');

	// Photo: picked -> cropped -> STAGED in the ?/save form's own file input and
	// previewed locally. The actual upload rides the multipart ?/save submit, so an
	// unsaved application can pick a photo without losing its form state.
	let photoInput: HTMLInputElement | undefined = $state();
	let cropping = $state<File | null>(null);
	let stagedPhotoUrl = $state<string | null>(null); // local object URL preview

	function onPhotoChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = ''; // the cropped result replaces it on confirm
		cropping = file;
	}
	function onCropConfirm(cropped: File) {
		cropping = null;
		if (!photoInput) return;
		const dt = new DataTransfer();
		dt.items.add(cropped);
		photoInput.files = dt.files;
		if (stagedPhotoUrl) URL.revokeObjectURL(stagedPhotoUrl);
		stagedPhotoUrl = URL.createObjectURL(cropped);
	}

	let adding = $state<'leadership' | 'professional' | 'education' | null>(null);
	function toggleAdding(type: 'leadership' | 'professional' | 'education') {
		adding = adding === type ? null : type;
	}

	type PendingExperience = {
		type: 'education' | 'professional';
		title: string;
		institution: string;
		description: string;
		from: string; // year, e.g. "2013"
		to: string | null;
	};
	type PendingLeadership = {
		positionId: number;
		positionLabel: string;
		partyId: number | null;
		partyName: string | null;
		description: string;
		from: string; // year, e.g. "2013"
		to: string | null;
	};

	let pendingExperience = $state<PendingExperience[]>([]);
	let pendingLeadership = $state<PendingLeadership[]>([]);

	// Already-saved rows staged for removal (by id) — actually deleted server-side
	// only when "Save profile" is clicked, same deferred-save model as additions.
	let removedExperienceIds = $state<number[]>([]);
	let removedLeadershipIds = $state<number[]>([]);
	const visibleExperience = $derived(
		data.existingExperience.filter((e) => !removedExperienceIds.includes(e.id))
	);
	const visibleLeadership = $derived(
		data.existingLeadership.filter((l) => !removedLeadershipIds.includes(l.id))
	);

	// Inline "add" form fields — cleared after each staged entry.
	let expTitle = $state('');
	let expInstitution = $state('');
	let expDescription = $state('');
	let expFrom = $state('');
	let expTo = $state('');

	let leadPositionId = $state<number | ''>('');
	let leadPartyId = $state<number | ''>('');
	let leadDescription = $state('');
	let leadFrom = $state('');
	let leadTo = $state('');
	let leadResetKey = $state(0);

	// "To" before "From" is invalid — same rule enforced again server-side.
	const expDateInvalid = $derived(!!expFrom && !!expTo && expTo < expFrom);
	const leadDateInvalid = $derived(!!leadFrom && !!leadTo && leadTo < leadFrom);

	// Year dropdown options, newest first. The "To" pickers filter to years >= the
	// picked "From", so an inverted range can't be selected in the first place
	// (the *Invalid deriveds above stay as backstops for stale picks).
	const years = Array.from({ length: 2030 - 1950 + 1 }, (_, i) => String(2030 - i));
	const expToYears = $derived(expFrom ? years.filter((y) => y >= expFrom) : years);
	const leadToYears = $derived(leadFrom ? years.filter((y) => y >= leadFrom) : years);

	function addExperience() {
		if (adding !== 'professional' && adding !== 'education') return;
		if (!expTitle.trim() || !expInstitution.trim() || !expFrom || expDateInvalid) return;
		pendingExperience.push({
			type: adding,
			title: expTitle.trim(),
			institution: expInstitution.trim(),
			description: expDescription.trim(),
			from: expFrom,
			to: expTo || null
		});
		expTitle = expInstitution = expDescription = expFrom = expTo = '';
		adding = null;
	}

	function addLeadership() {
		if (!leadPositionId || !leadFrom || leadDateInvalid) return;
		const position = data.positions.find((p) => p.id === leadPositionId);
		if (!position) return;
		const party = leadPartyId ? data.parties?.find((p) => p.id === leadPartyId) : null;
		pendingLeadership.push({
			positionId: leadPositionId,
			positionLabel: `${position.title}, ${position.region}`,
			partyId: leadPartyId || null,
			partyName: party?.name ?? null,
			description: leadDescription.trim(),
			from: leadFrom,
			to: leadTo || null
		});
		leadPositionId = '';
		leadPartyId = '';
		leadDescription = leadFrom = leadTo = '';
		leadResetKey++;
		adding = null;
	}

	function removeExperience(i: number) {
		pendingExperience.splice(i, 1);
	}
	function removeLeadership(i: number) {
		pendingLeadership.splice(i, 1);
	}
	// Removing a SAVED item is destructive on the next profile save, so confirm
	// first (unsaved/pending adds are discarded without a prompt — nothing's lost).
	function removeExistingExperience(id: number) {
		if (
			!confirm(
				'Remove this experience from the profile? It, and anything delivered under it, is deleted when you save.'
			)
		)
			return;
		removedExperienceIds.push(id);
	}
	function removeExistingLeadership(id: number) {
		if (
			!confirm(
				'Remove this role from the profile? It, and anything delivered under it, is deleted when you save.'
			)
		)
			return;
		removedLeadershipIds.push(id);
	}

	// Editing an elected/leadership role (pencil), same staged-edit model as the
	// experience rows: a SAVED role's edit is kept in editedLeadership (keyed by
	// id) and applied in place on Save profile, preserving the row id + anything
	// delivered under it. A PENDING role's pencil reloads it into the add form.
	type LeadEdit = {
		positionId: number;
		partyId: number | null;
		description: string;
		from: string;
		to: string | null;
	};
	let editingLeadId = $state<number | null>(null);
	let editedLeadership = $state<Record<number, LeadEdit>>({});

	function viewLead(item: (typeof data.existingLeadership)[number]) {
		const e = editedLeadership[item.id];
		if (!e) return item;
		const position = data.positions.find((p) => p.id === e.positionId);
		const party = e.partyId ? data.parties?.find((p) => p.id === e.partyId) : null;
		return {
			...item,
			positionTitle: position?.title ?? item.positionTitle,
			region: position?.region ?? item.region,
			partyName: party?.name ?? null,
			description: e.description,
			from: e.from ? Number(e.from) : item.from,
			to: e.to ? Number(e.to) : null
		};
	}

	function startEditLeadership(item: (typeof data.existingLeadership)[number]) {
		const e = editedLeadership[item.id];
		leadPositionId = e?.positionId ?? findPositionId(item.positionTitle, item.region) ?? '';
		leadPartyId = (e ? e.partyId : item.partyId) ?? '';
		leadDescription = e?.description ?? item.description ?? '';
		leadFrom = e?.from ?? String(item.from);
		leadTo = e?.to ?? (item.to != null ? String(item.to) : '');
		// Inline edit form renders off editingLeadId, not the bottom add form.
		adding = null;
		editingExpId = null;
		editingLeadId = item.id;
		leadResetKey++; // remount PositionSelector so it inits to the prefilled position
	}

	function findPositionId(title: string, region: string): number | '' {
		return data.positions.find((p) => p.title === title && p.region === region)?.id ?? '';
	}

	function saveEditLeadership() {
		if (editingLeadId === null) return;
		if (!leadPositionId || !leadFrom || leadDateInvalid) return;
		editedLeadership[editingLeadId] = {
			positionId: leadPositionId,
			partyId: leadPartyId || null,
			description: leadDescription.trim(),
			from: leadFrom,
			to: leadTo || null
		};
		leadPositionId = '';
		leadPartyId = '';
		leadDescription = leadFrom = leadTo = '';
		leadResetKey++;
		adding = null;
		editingLeadId = null;
	}

	function editPendingLeadership(i: number) {
		const item = pendingLeadership[i];
		leadPositionId = item.positionId;
		leadPartyId = item.partyId ?? '';
		leadDescription = item.description;
		leadFrom = item.from;
		leadTo = item.to ?? '';
		adding = 'leadership';
		editingLeadId = null;
		pendingLeadership.splice(i, 1);
		leadResetKey++;
	}

	function cancelEditLeadership() {
		leadPositionId = '';
		leadPartyId = '';
		leadDescription = leadFrom = leadTo = '';
		leadResetKey++;
		adding = null;
		editingLeadId = null;
	}

	// Editing (pencil): reuses the same inline form the "+ Professional/Education"
	// buttons open, pre-filled. A SAVED row's edit is staged in editedExperience
	// (keyed by id) and applied in place on Save profile — the row id and anything
	// delivered under it survive, unlike remove-and-re-add. A PENDING row's edit
	// just reloads it into the add form and drops the old draft.
	type ExpEdit = {
		title: string;
		institution: string;
		description: string;
		from: string;
		to: string | null;
	};
	let editingExpId = $state<number | null>(null);
	let editedExperience = $state<Record<number, ExpEdit>>({});

	// Display values for a saved experience row: its staged edit if one exists.
	function viewExp(item: (typeof data.existingExperience)[number]) {
		const e = editedExperience[item.id];
		if (!e) return item;
		return {
			...item,
			title: e.title,
			institution: e.institution,
			description: e.description,
			from: e.from ? Number(e.from) : null,
			to: e.to ? Number(e.to) : null
		};
	}

	function startEditExperience(item: (typeof data.existingExperience)[number]) {
		const e = editedExperience[item.id];
		expTitle = e?.title ?? item.title;
		expInstitution = e?.institution ?? item.institution;
		expDescription = e?.description ?? item.description ?? '';
		expFrom = e?.from ?? (item.from != null ? String(item.from) : '');
		expTo = e?.to ?? (item.to != null ? String(item.to) : '');
		// The inline edit form (below the entry) renders off editingExpId, not the
		// bottom add form — so close any open add form / other edit.
		adding = null;
		editingLeadId = null;
		editingExpId = item.id;
	}

	function saveEditExperience() {
		if (editingExpId === null) return;
		if (!expTitle.trim() || !expInstitution.trim() || !expFrom || expDateInvalid) return;
		editedExperience[editingExpId] = {
			title: expTitle.trim(),
			institution: expInstitution.trim(),
			description: expDescription.trim(),
			from: expFrom,
			to: expTo || null
		};
		expTitle = expInstitution = expDescription = expFrom = expTo = '';
		adding = null;
		editingExpId = null;
	}

	function editPendingExperience(i: number) {
		const item = pendingExperience[i];
		expTitle = item.title;
		expInstitution = item.institution;
		expDescription = item.description;
		expFrom = item.from;
		expTo = item.to ?? '';
		adding = item.type;
		editingExpId = null;
		pendingExperience.splice(i, 1);
	}

	function cancelEditExperience() {
		expTitle = expInstitution = expDescription = expFrom = expTo = '';
		adding = null;
		editingExpId = null;
	}

	// Deliveries (merged from the old Delivery tab): saved immediately per item,
	// independent of the deferred profile save. One add-form open at a time.
	let openDelivery = $state<string | null>(null);
	let delTitle = $state('');
	let delDescription = $state('');
	function toggleDelivery(target: string) {
		openDelivery = openDelivery === target ? null : target;
		delTitle = '';
		delDescription = '';
	}
	const deliveriesFor = (target: string): DeliveryItem[] => data.deliveriesByTarget?.[target] ?? [];
</script>

<svelte:head><title>Profile — vote.ke</title></svelte:head>

<div class="">
	<h2 class="text-xl font-bold text-heading">Leader's Profile</h2>
	<p class="text-sm text-muted">This is what citizens see on the leader's public profile/page.</p>

	{#if form?.error}
		<div
			class="mt-4 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading"
		>
			{form.error}
		</div>
	{/if}
	<!-- Verification submission ("Submit Application") now lives in the layout,
	top-right — it's gated on Profile/Contacts/Team together, not just this page,
	so it can't live inside a single tab. -->

	<!-- The profile fields form. The experience section (below) is deliberately
	OUTSIDE it: each delivery there saves via its own immediate-POST form, which
	can't legally nest inside this one. Staged experience adds/removes still ride
	this form via the hidden inputs, and the bottom "Save profile" button posts
	here via the form="profile-form" association. -->
	<form
		id="profile-form"
		method="post"
		action="?/save"
		enctype="multipart/form-data"
		class="mt-4 space-y-5"
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				saving = false;
				if (result.type === 'success') {
					pendingExperience = [];
					pendingLeadership = [];
					removedExperienceIds = [];
					removedLeadershipIds = [];
					// The staged photo is now saved server-side; data.photoUrl takes over.
					if (stagedPhotoUrl) URL.revokeObjectURL(stagedPhotoUrl);
					stagedPhotoUrl = null;
					if (photoInput) photoInput.value = '';
					// Claim family: the first save unlocks Contacts/Signoff (see the layout's
					// tab gating) — move the claimant there instead of leaving them on a
					// tab whose only job just finished. A later re-edit (e.g. after a
					// rejection) stays put so they can keep tweaking the profile.
					if (advanceOnSave) {
						await goto(page.url.pathname.replace(/\/profile$/, '/contacts'));
						return;
					}
				}
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="experienceEntries" value={JSON.stringify(pendingExperience)} />
		<input type="hidden" name="leadershipEntries" value={JSON.stringify(pendingLeadership)} />
		<input type="hidden" name="removedExperienceIds" value={JSON.stringify(removedExperienceIds)} />
		<input type="hidden" name="removedLeadershipIds" value={JSON.stringify(removedLeadershipIds)} />
		<input
			type="hidden"
			name="editedExperienceEntries"
			value={JSON.stringify(
				Object.entries(editedExperience).map(([id, e]) => ({ id: Number(id), ...e }))
			)}
		/>
		<input
			type="hidden"
			name="editedLeadershipEntries"
			value={JSON.stringify(
				Object.entries(editedLeadership).map(([id, e]) => ({ id: Number(id), ...e }))
			)}
		/>

		<!-- Left: name, party, IEBC certificate. Right end: photo. Both columns share a
		fixed height; the left column spreads its field groups with space-between. -->
		<div class="flex gap-5 flex-col sm:flex-row">
			<!-- Right side: fixed square photo (a fixed size beats aspect-ratio here, which
			the flex column was compressing). -->
			<div class="flex flex-col shrink-0">
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm font-medium text-heading"
						>Photo <span class={starClass('Photo')}>*</span></span
					>
					{#if stagedPhotoUrl}
						<button
							type="submit"
							disabled={saving || (claimAttestation && !attested)}
							class="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
						>
							{saving ? 'Saving…' : 'Save'}
						</button>
					{/if}
				</div>
				<label
					class="group relative mt-1.5 block aspect-square shrink-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-surface-2 size-50 sm:size-60"
				>
					{#if stagedPhotoUrl || data.photoUrl}
						<img src={stagedPhotoUrl ?? data.photoUrl} alt="Leader" class="h-full object-cover" />
						<span
							class="absolute inset-x-0 bottom-0 bg-black/55 py-1.5 text-center text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100"
						>
							Change photo
						</span>
					{:else}
						<span
							class="flex h-full w-full flex-col items-center justify-center gap-1 text-center text-xs font-medium text-muted"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								class="size-7"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
								/>
							</svg>
							Upload photo
						</span>
					{/if}
					<input
						type="file"
						name="photo"
						accept="image/*"
						bind:this={photoInput}
						onchange={onPhotoChange}
						class="sr-only"
					/>
				</label>
				{#if stagedPhotoUrl}
					<p class="mt-1 max-w-36 text-xs font-medium text-muted">
						Uploads when you press "Save profile".
					</p>
				{/if}
			</div>
			<div class="flex flex-1 flex-col gap-5 sm:gap-1 sm:justify-between">
				<div class="flex flex-col sm:flex-row gap-1 sm:gap-3">
					<label class="flex-1">
						<span class="text-sm font-medium text-heading"
							>First name <span class={starClass('First name')}>*</span></span
						>
						<input
							type="text"
							name="firstName"
							required
							value={data.form.firstName}
							class="mt-1.5 w-full rounded-xl border bg-surface px-4 py-2.5 text-sm text-heading focus:ring-0 focus:outline-none {errorClass()}"
						/>
					</label>
					<label class="flex-2">
						<span class="text-sm font-medium text-heading"
							>Other names <span class={starClass('Other names')}>*</span></span
						>
						<input
							type="text"
							name="otherNames"
							required
							value={data.form.otherNames}
							class="mt-1.5 w-full rounded-xl border bg-surface px-4 py-2.5 text-sm text-heading focus:ring-0 focus:outline-none {errorClass()}"
						/>
					</label>
				</div>
				{#if missing.has('firstName') || missing.has('otherNames')}
					<p class="-mt-3 text-sm font-medium text-red-500">{form?.error}</p>
				{/if}
				<div class="block">
					<span class="text-sm font-medium text-heading"
						>Bio <span class={starClass('Bio')}>*</span></span
					>
					<div class="mt-1.5">
						<RichTextEditor
							name="bio"
							bind:value={bio}
							rows={5}
							placeholder="Who you are, what you have done, and why you are running."
						/>
					</div>
				</div>
				{#if missing.has('bio')}
					<p class="-mt-3 text-sm font-medium text-red-500">{form?.error}</p>
				{/if}
			</div>
		</div>

		{#if data.form.verified}
			<label class="block">
				<span class="text-sm font-medium text-heading">Your public URL</span>
				<div
					class="mt-1.5 flex items-center rounded-xl border border-border bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-ring"
				>
					<span class="pl-4 text-sm text-muted">vote.ke/</span>
					<input
						type="text"
						name="slug"
						placeholder={data.form.slug ?? 'your-name'}
						value={data.form.slug ?? ''}
						class="w-full border-0 bg-transparent py-2.5 pr-4 pl-1 text-sm text-heading placeholder:text-muted focus:outline-none"
					/>
				</div>
				<p class="mt-1 text-xs text-muted">
					This is your permanent profile link. Leave unchanged unless you want a different one.
				</p>
			</label>
		{/if}

		{#if claimAttestation}
			<label class="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-4">
				<input
					type="checkbox"
					name="attested"
					value="true"
					required
					bind:checked={attested}
					class="mt-0.5 size-4 shrink-0 rounded border-border text-primary focus:ring-ring"
				/>
				<span class="text-sm text-heading">
					I confirm that I am this person, or an authorized representative acting on their behalf,
					and I understand that submitting a false or fraudulent claim may carry legal consequences.
				</span>
			</label>
		{/if}
	</form>

	{#if data.form.hasLeader}
		<div class="mt-5 border-t border-border pt-6">
			<div class="flex items-center justify-between">
				<h3 class="text-lg font-semibold text-heading">Add Experience</h3>
				<h4 class="text-sm text-muted italic">List your past and current roles here</h4>
			</div>
			<p class="mt-1 text-xs text-muted">
				Add what you delivered under each role. {data.pinnedCount ?? 0} of {data.maxPinned ?? 5} pinned
				deliveries show on your public profile.
			</p>

			{#if form?.deliveryError}
				<div
					class="mt-3 rounded-xl border border-border bg-surface-2 p-3 text-sm font-medium text-heading"
				>
					{form.deliveryError}
				</div>
			{/if}

			{#if visibleLeadership.length > 0 || pendingLeadership.length > 0}
				<h4 class="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">Leadership</h4>
				<ul class="mt-2 space-y-2">
					{#each visibleLeadership as item (item.id)}
						{#if editingLeadId === item.id}
							<li transition:slide>{@render leadForm()}</li>
						{/if}
						{@const v = viewLead(item)}
						<ExperienceBlock
							title="{v.positionTitle}, {v.region}"
							subtitle={v.partyName}
							description={v.description}
							dateLabel="{v.from}–{v.to ?? 'present'}"
							unsaved={!!editedLeadership[item.id]}
							onEdit={() => startEditLeadership(item)}
							onRemove={() => removeExistingLeadership(item.id)}
						>
							{#snippet footer()}{@render deliveryFooter(`leader:${item.id}`)}{/snippet}
						</ExperienceBlock>
					{/each}
					{#each pendingLeadership as item, i (i)}
						<ExperienceBlock
							title={item.positionLabel}
							subtitle={item.partyName}
							description={item.description}
							dateLabel="{item.from}–{item.to ?? 'present'}"
							unsaved
							pending
							onEdit={() => editPendingLeadership(i)}
							onRemove={() => removeLeadership(i)}
						/>
					{/each}
				</ul>
			{/if}

			{#if visibleExperience.some((e) => e.type === 'professional') || pendingExperience.some((e) => e.type === 'professional')}
				<h4 class="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">Professional</h4>
				<ul class="mt-2 space-y-2">
					{#each visibleExperience.filter((e) => e.type === 'professional') as item (item.id)}
						{#if editingExpId === item.id}
							<li transition:slide>{@render expForm('professional')}</li>
						{/if}
						{@const v = viewExp(item)}
						<ExperienceBlock
							title={v.title}
							subtitle={v.institution}
							description={v.description}
							dateLabel="{v.from}{v.to ? `–${v.to}` : ''}"
							unsaved={!!editedExperience[item.id]}
							onEdit={() => startEditExperience(item)}
							onRemove={() => removeExistingExperience(item.id)}
						>
							{#snippet footer()}{@render deliveryFooter(`experience:${item.id}`)}{/snippet}
						</ExperienceBlock>
					{/each}
					{#each pendingExperience as item, i (i)}
						{#if item.type === 'professional'}
							<ExperienceBlock
								title={item.title}
								subtitle={item.institution}
								description={item.description}
								dateLabel="{item.from}{item.to ? `–${item.to}` : ''}"
								unsaved
								pending
								onEdit={() => editPendingExperience(i)}
								onRemove={() => removeExperience(i)}
							/>
						{/if}
					{/each}
				</ul>
			{/if}

			{#if visibleExperience.some((e) => e.type === 'education') || pendingExperience.some((e) => e.type === 'education')}
				<h4 class="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">Education</h4>
				<ul class="mt-2 space-y-2">
					{#each visibleExperience.filter((e) => e.type === 'education') as item (item.id)}
						{#if editingExpId === item.id}
							<li transition:slide>{@render expForm('education')}</li>
						{/if}
						{@const v = viewExp(item)}
						<ExperienceBlock
							title={v.title}
							subtitle={v.institution}
							description={v.description}
							dateLabel="{v.from}{v.to ? `–${v.to}` : ''}"
							unsaved={!!editedExperience[item.id]}
							onEdit={() => startEditExperience(item)}
							onRemove={() => removeExistingExperience(item.id)}
						>
							{#snippet footer()}{@render deliveryFooter(`experience:${item.id}`)}{/snippet}
						</ExperienceBlock>
					{/each}
					{#each pendingExperience as item, i (i)}
						{#if item.type === 'education'}
							<ExperienceBlock
								title={item.title}
								subtitle={item.institution}
								description={item.description}
								dateLabel="{item.from}{item.to ? `–${item.to}` : ''}"
								unsaved
								pending
								onEdit={() => editPendingExperience(i)}
								onRemove={() => removeExperience(i)}
							/>
						{/if}
					{/each}
				</ul>
			{/if}

			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => toggleAdding('leadership')}
					class="rounded-full border px-4 py-2 text-sm font-semibold transition {adding ===
					'leadership'
						? 'border-primary bg-primary text-on-primary'
						: 'border-border bg-surface text-heading hover:bg-surface-2'}"
				>
					+ Elected
				</button>
				<button
					type="button"
					onclick={() => toggleAdding('professional')}
					class="rounded-full border px-4 py-2 text-sm font-semibold transition {adding ===
					'professional'
						? 'border-primary bg-primary text-on-primary'
						: 'border-border bg-surface text-heading hover:bg-surface-2'}"
				>
					+ Professional
				</button>
				<button
					type="button"
					onclick={() => toggleAdding('education')}
					class="rounded-full border px-4 py-2 text-sm font-semibold transition {adding ===
					'education'
						? 'border-primary bg-primary text-on-primary'
						: 'border-border bg-surface text-heading hover:bg-surface-2'}"
				>
					+ Education
				</button>
			</div>

			<!-- One add/edit form each, as snippets: rendered here for ADD (the +
			buttons), and inline above an entry for EDIT (the pencil) — see the lists
			above. The Save/Add button + Cancel key off editingExpId / editingLeadId. -->
			{#if adding === 'leadership'}
				<div class="mt-4">{@render leadForm()}</div>
			{:else if adding === 'professional' || adding === 'education'}
				<div class="mt-4">{@render expForm(adding)}</div>
			{/if}
		</div>
	{/if}

	<div class="mt-5 border-t border-border pt-6">
		<button
			type="submit"
			form="profile-form"
			disabled={saving || (claimAttestation && !attested)}
			class="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
		>
			{saving ? 'Saving…' : 'Save profile'}
		</button>
	</div>

	{#if !data.form.hasLeader}
		<p class="mt-8 border-t border-border pt-5 text-sm text-muted">
			Save your profile to unlock the next step...
		</p>
	{/if}
</div>

<!-- Elected-role add/edit form (leadership). Save/Add + Cancel key off
editingLeadId, so the same snippet serves the bottom add form and the inline
edit form that slides out above a role. -->
{#snippet leadForm()}
	{#key leadResetKey}
		<div class="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
			<PositionSelector
				positions={data.positions}
				verified={false}
				initialPositionId={leadPositionId || null}
				label="Position held"
				required={false}
				bind:value={leadPositionId}
			/>
			{#if data.parties}
				<label class="block">
					<span class="text-sm font-medium text-heading">Party held under</span>
					<select
						bind:value={leadPartyId}
						class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
					>
						<option value="">Independent (no party)</option>
						{#each data.parties as party (party.id)}
							<option value={party.id}>{party.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<label class="block">
				<span class="text-sm font-medium text-heading">Description</span>
				<input
					type="text"
					bind:value={leadDescription}
					maxlength="255"
					placeholder="Optional"
					class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				/>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-sm font-medium text-heading">From</span>
					<select
						bind:value={leadFrom}
						class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
					>
						<option value="">Year</option>
						{#each years as year (year)}
							<option value={year}>{year}</option>
						{/each}
					</select>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-heading">To (optional)</span>
					<select
						bind:value={leadTo}
						class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
					>
						<option value="">Ongoing</option>
						{#each leadToYears as year (year)}
							<option value={year}>{year}</option>
						{/each}
					</select>
				</label>
			</div>
			{#if leadDateInvalid}
				<p class="text-sm font-medium text-heading">"To" can't be before "From".</p>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					onclick={editingLeadId !== null ? saveEditLeadership : addLeadership}
					disabled={!leadPositionId || !leadFrom || leadDateInvalid}
					class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
				>
					{editingLeadId !== null ? 'Save changes' : 'Add elected role'}
				</button>
				{#if editingLeadId !== null}
					<button
						type="button"
						onclick={cancelEditLeadership}
						class="rounded-full px-4 py-2 text-sm font-medium text-muted transition hover:text-heading"
					>
						Cancel
					</button>
				{/if}
			</div>
		</div>
	{/key}
{/snippet}

<!-- Professional/Education add/edit form. `kind` drives the placeholders; the
Save/Add + Cancel key off editingExpId. -->
{#snippet expForm(kind: 'professional' | 'education')}
	<div class="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
		<label class="block">
			<span class="text-sm font-medium text-heading">Title</span>
			<input
				type="text"
				bind:value={expTitle}
				placeholder={kind === 'education' ? 'Bachelor of Laws (LL.B.)' : 'Minister for Agriculture'}
				class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
			/>
		</label>
		<label class="block">
			<span class="text-sm font-medium text-heading">Institution</span>
			<input
				type="text"
				bind:value={expInstitution}
				placeholder={kind === 'education' ? 'University of Nairobi' : 'Government of Kenya'}
				class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
			/>
		</label>
		<label class="block">
			<span class="text-sm font-medium text-heading">Description</span>
			<textarea
				bind:value={expDescription}
				maxlength="500"
				rows="3"
				placeholder="Optional: what the role or study involved and achieved"
				class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
			></textarea>
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-sm font-medium text-heading">From</span>
				<select
					bind:value={expFrom}
					class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				>
					<option value="">Year</option>
					{#each years as year (year)}
						<option value={year}>{year}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="text-sm font-medium text-heading">To (optional)</span>
				<select
					bind:value={expTo}
					class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				>
					<option value="">Ongoing</option>
					{#each expToYears as year (year)}
						<option value={year}>{year}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if expDateInvalid}
			<p class="text-sm font-medium text-heading">"To" can't be before "From".</p>
		{/if}
		<div class="flex gap-2">
			<button
				type="button"
				onclick={editingExpId !== null ? saveEditExperience : addExperience}
				disabled={!expTitle.trim() || !expInstitution.trim() || !expFrom || expDateInvalid}
				class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
			>
				{editingExpId !== null ? 'Save changes' : `Add ${kind}`}
			</button>
			{#if editingExpId !== null}
				<button
					type="button"
					onclick={cancelEditExperience}
					class="rounded-full px-4 py-2 text-sm font-medium text-muted transition hover:text-heading"
				>
					Cancel
				</button>
			{/if}
		</div>
	</div>
{/snippet}

<!-- Deliveries under one experience item (target = "leader:<id>" / "experience:<id>").
Standalone POST forms — outside #profile-form — so each saves immediately. -->
{#snippet deliveryFooter(target: string)}
	<div class="mt-2 border-t border-border/60 pt-2">
		{#if deliveriesFor(target).length > 0}
			<ul class="space-y-1">
				{#each deliveriesFor(target) as d (d.id)}
					<li class="flex items-start gap-2 text-xs">
						<span class="flex-1 text-heading">
							{d.title}{#if d.description}
								<span class="text-muted">— {d.description}</span>{/if}
						</span>
						<form method="post" action="?/togglePinDelivery" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button
								type="submit"
								aria-label={d.pinned ? 'Unpin from public profile' : 'Pin to public profile'}
								title={d.pinned ? 'Pinned — shows on public profile' : 'Pin to public profile'}
								class="{d.pinned ? 'text-primary' : 'text-muted'} hover:text-primary"
							>
								<svg
									viewBox="0 0 24 24"
									class="size-4"
									fill={d.pinned ? 'currentColor' : 'none'}
									stroke="currentColor"
									stroke-width="1.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M9 4h6l-1 6 3 3v2h-5v5l-1 1-1-1v-5H4v-2l3-3-1-6z"
									/>
								</svg>
							</button>
						</form>
						<form
							method="post"
							action="?/removeDelivery"
							use:enhance={({ cancel }) => {
								if (!confirm(`Delete "${d.title}"?`)) {
									cancel();
									return;
								}
								return async ({ update }) => await update({ reset: false });
							}}
						>
							<input type="hidden" name="id" value={d.id} />
							<button
								type="submit"
								aria-label="Delete delivery"
								class="text-muted hover:text-red-600">✕</button
							>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-1 flex justify-end">
			<button
				type="button"
				onclick={() => toggleDelivery(target)}
				class="text-xs font-semibold text-primary hover:underline"
			>
				{openDelivery === target ? 'Cancel' : '+ Delivered'}
			</button>
		</div>

		{#if openDelivery === target}
			<form
				method="post"
				action="?/addDelivery"
				class="mt-1 space-y-2"
				use:enhance={() => {
					return async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							delTitle = '';
							delDescription = '';
							openDelivery = null;
						}
					};
				}}
			>
				<input type="hidden" name="target" value={target} />
				<input
					type="text"
					name="title"
					required
					bind:value={delTitle}
					placeholder="What was delivered"
					class="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
				/>
				<input
					type="text"
					name="description"
					bind:value={delDescription}
					placeholder="Optional detail or proof link"
					class="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none"
				/>
				<button
					type="submit"
					class="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-on-primary transition hover:brightness-95"
				>
					Add delivery
				</button>
			</form>
		{/if}
	</div>
{/snippet}

{#if cropping}
	<!-- Leader photo crops to a square (1:1). -->
	<ImageCropper
		file={cropping}
		aspect={1}
		onconfirm={onCropConfirm}
		oncancel={() => (cropping = null)}
	/>
{/if}
