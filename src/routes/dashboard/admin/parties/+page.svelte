<script lang="ts">
	import { enhance } from '$app/forms';
	import PartiesTable from '$lib/components/PartiesTable.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import ImageCropper from '$lib/components/ImageCropper.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Party = (typeof data.parties)[number];
	let showForm = $state(false);
	let editing = $state<Party | null>(null);
	let saving = $state(false);

	// Logo: picked -> square-cropped (raster) or passed through (SVG) -> STAGED in
	// the form's own file input and previewed locally, uploaded with the submit —
	// same staging model as the leader photo.
	let logoInput: HTMLInputElement | undefined = $state();
	let cropping = $state<File | null>(null);
	let stagedLogoUrl = $state<string | null>(null);

	function resetLogo() {
		cropping = null;
		if (stagedLogoUrl) URL.revokeObjectURL(stagedLogoUrl);
		stagedLogoUrl = null;
	}
	function onLogoChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// Everything — SVG included — goes through the square crop and is rasterized
		// to PNG, so every logo renders uniformly regardless of source format.
		input.value = ''; // the cropped result replaces it on confirm
		cropping = file;
	}
	function onCropConfirm(cropped: File) {
		cropping = null;
		if (!logoInput) return;
		const dt = new DataTransfer();
		dt.items.add(cropped);
		logoInput.files = dt.files;
		if (stagedLogoUrl) URL.revokeObjectURL(stagedLogoUrl);
		stagedLogoUrl = URL.createObjectURL(cropped);
	}

	function openCreate() {
		editing = null;
		resetLogo();
		showForm = true;
	}
	function openEdit(id: number) {
		editing = data.parties.find((p) => p.id === id) ?? null;
		resetLogo();
		showForm = true;
	}
	function close() {
		showForm = false;
		editing = null;
		resetLogo();
	}

	const inputClass =
		'mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none';
</script>

<svelte:head><title>Parties — Admin — vote.ke</title></svelte:head>

<div class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-lg font-semibold text-heading">Parties</h1>
		<p class="mt-1 text-sm text-muted">
			Add, edit, and verify parties. Verify once name, symbol, colors and status have been checked against the ORPP register.
		</p>
	</div>
	<button
		type="button"
		onclick={openCreate}
		class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
	>
		+ New party
	</button>
</div>

<div class="mt-6">
	<PartiesTable parties={data.parties} showActions error={form?.error} onEdit={openEdit} />
</div>

{#if showForm}
	<!-- Create/edit overlay. Keyed so switching between parties (or to "new")
	remounts the fields with the right prefill. -->
	<div class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
		<div class="my-8 w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-xl">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-heading">{editing ? `Edit ${editing.name}` : 'New party'}</h2>
				<button type="button" onclick={close} aria-label="Close" class="text-muted hover:text-heading">✕</button>
			</div>

			{#if form?.error}
				<div class="mt-4 rounded-xl border border-border bg-surface-2 p-3 text-sm font-medium text-heading">{form.error}</div>
			{/if}

			{#key editing?.id ?? 'new'}
				<form
					method="post"
					action={editing ? '?/edit' : '?/create'}
					enctype="multipart/form-data"
					class="mt-4 space-y-4"
					use:enhance={() => {
						saving = true;
						return async ({ result, update }) => {
							saving = false;
							await update();
							if (result.type === 'success') close();
						};
					}}
				>
					{#if editing}<input type="hidden" name="partyId" value={editing.id} />{/if}

					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block sm:col-span-2">
							<span class="text-sm font-medium text-heading">Name <span class="text-red-500">*</span></span>
							<input type="text" name="name" required value={editing?.name ?? ''} placeholder="United Democratic Alliance" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Abbreviation</span>
							<input type="text" name="abbreviation" value={editing?.abbreviation ?? ''} placeholder="UDA" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">ORPP status <span class="text-red-500">*</span></span>
							<select name="status" class={inputClass}>
								<option value="full" selected={editing?.status === 'full'}>Full registration</option>
								<option value="provisional" selected={editing?.status === 'provisional'}>Provisional</option>
							</select>
						</label>
						<label class="block sm:col-span-2">
							<span class="text-sm font-medium text-heading">Slogan</span>
							<input type="text" name="slogan" value={editing?.slogan ?? ''} placeholder="Kazi ni kazi" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Symbol</span>
							<input type="text" name="symbol" value={editing?.symbol ?? ''} placeholder="Wheelbarrow" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Colors</span>
							<input type="text" name="colors" value={editing?.colors ?? ''} placeholder="Yellow and white" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Head office</span>
							<input type="text" name="hq" value={editing?.hq ?? ''} placeholder="Nairobi" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Postal address</span>
							<input type="text" name="postal" value={editing?.postal ?? ''} placeholder="P.O. Box 12345-00100" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Phone</span>
							<input type="text" name="phone" value={editing?.contacts?.phone ?? ''} placeholder="0700 000 000" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">Email</span>
							<input type="email" name="email" value={editing?.contacts?.email ?? ''} placeholder="info@party.or.ke" class={inputClass} />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-heading">ORPP certified on</span>
							<input type="date" name="certifiedAt" value={editing?.certifiedDate ?? ''} class={inputClass} />
						</label>
						<label class="block sm:col-span-2">
							<span class="text-sm font-medium text-heading">Description</span>
							<textarea name="description" rows="3" value={editing?.description ?? ''} placeholder="What the party stands for." class={inputClass}></textarea>
						</label>
						<label class="block sm:col-span-2">
							<span class="text-sm font-medium text-heading">Notes</span>
							<input type="text" name="notes" value={editing?.notes ?? ''} placeholder="e.g. Formerly Wiper Democratic Movement (WDM)" class={inputClass} />
						</label>
						<div class="block sm:col-span-2">
							<span class="text-sm font-medium text-heading">Logo</span>
							<div class="mt-1 flex items-center gap-3">
								{#if stagedLogoUrl}
									<img src={stagedLogoUrl} alt="New logo preview" class="size-12 rounded-xl border border-border object-cover" />
								{:else if editing?.logo}
									<Avatar name={editing.name} initials={editing.abbreviation ?? editing.name.slice(0, 2)} photoUrl={editing.logo} sizeClass="size-12" textClass="text-xs" />
								{/if}
								<input
										type="file"
										name="logo"
										accept="image/png,image/jpeg,image/webp,image/svg+xml"
										bind:this={logoInput}
										onchange={onLogoChange}
										class="text-sm text-muted file:mr-3 file:rounded-full file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-heading"
									/>
							</div>
							<p class="mt-1 text-xs text-muted">PNG, JPEG, WebP, or SVG — square-cropped to PNG. Leave empty to keep the current logo.</p>
						</div>
					</div>

					<div class="flex justify-end gap-2 border-t border-border pt-4">
						<button type="button" onclick={close} class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2">Cancel</button>
						<button type="submit" disabled={saving} class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60">
							{saving ? 'Saving…' : editing ? 'Save changes' : 'Create party'}
						</button>
					</div>
				</form>
			{/key}
		</div>
	</div>
{/if}

{#if cropping}
	<!-- Logos crop to a square; PNG output keeps transparency. -->
	<ImageCropper file={cropping} aspect={1} mime="image/png" onconfirm={onCropConfirm} oncancel={() => (cropping = null)} />
{/if}
