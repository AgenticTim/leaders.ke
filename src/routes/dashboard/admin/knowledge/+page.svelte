<script lang="ts">
	// Platform knowledge: both halves of what the site-wide Ask box answers
	// platform questions from — curated reference Documents, and the public FAQ
	// that /faq also renders. Two tabs rather than two pages, since they're the
	// same job (what does the assistant know) with different shapes.
	import { enhance } from '$app/forms';
	import { toast } from '$lib/stores/toast';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let tab = $state<'docs' | 'faqs'>('docs');
	let editingId = $state<number | null>(null);
	let creating = $state(false);
	let editingFaqId = $state<number | null>(null);
	let creatingFaq = $state(false);

	// Existing sections offered as suggestions so a new question joins one of the
	// /faq page's groups instead of silently creating a near-duplicate heading.
	const sections = $derived([...new Set(data.faqs.map((f) => f.section))]);

	const inputClass =
		'mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:outline-none';

	function withToast(successMessage: string, onDone?: () => void) {
		return () => {
			return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: () => Promise<void> }) => {
				if (result.type === 'failure') toast.error(String(result.data?.error ?? 'Could not save.'));
				else if (result.type === 'success') {
					toast.success(successMessage);
					onDone?.();
				}
				await update();
			};
		};
	}
</script>

<svelte:head><title>Knowledge · Admin</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">Knowledge</h1>
	<p class="mt-1 text-sm text-muted">
		What the site-wide Ask box answers platform and civics questions from.
	</p>

	<div class="mt-4 flex gap-1 border-b border-border">
		<button
			type="button"
			onclick={() => (tab = 'docs')}
			class="border-b-2 px-4 py-2.5 text-sm font-medium transition {tab === 'docs' ? 'border-primary text-heading' : 'border-transparent text-muted hover:text-heading'}"
		>
			Documents ({data.docs.length})
		</button>
		<button
			type="button"
			onclick={() => (tab = 'faqs')}
			class="border-b-2 px-4 py-2.5 text-sm font-medium transition {tab === 'faqs' ? 'border-primary text-heading' : 'border-transparent text-muted hover:text-heading'}"
		>
			FAQ ({data.faqs.length})
		</button>
	</div>

	{#if tab === 'docs'}
	<p class="mt-4 text-sm text-muted">
		Reference text for civics questions: registration how-tos, election dates, the citizen and
		ambassador manuals. A document is only pulled into an answer when the question contains one of
		its keywords, so keywords are what make it reachable.
	</p>

	{#snippet fields(doc?: { title: string; body: string; sourceUrl: string | null; keywords: string })}
		<label class="block">
			<span class="text-xs font-medium text-muted">Title</span>
			<input type="text" name="title" required value={doc?.title ?? ''} placeholder="How to check your voter registration" class={inputClass} />
		</label>
		<label class="mt-3 block">
			<span class="text-xs font-medium text-muted">Keywords (comma separated)</span>
			<input type="text" name="keywords" required value={doc?.keywords ?? ''} placeholder="register, registration, iebc, voter card" class={inputClass} />
		</label>
		<label class="mt-3 block">
			<span class="text-xs font-medium text-muted">Source URL (optional)</span>
			<input type="url" name="sourceUrl" value={doc?.sourceUrl ?? ''} placeholder="https://www.iebc.or.ke/…" class={inputClass} />
		</label>
		<label class="mt-3 block">
			<span class="text-xs font-medium text-muted">Body — the text the AI answers from</span>
			<textarea name="body" rows="6" required placeholder="Plain, factual reference text." class={inputClass}>{doc?.body ?? ''}</textarea>
		</label>
	{/snippet}

	{#if creating}
		<form
			method="post"
			action="?/create"
			class="mt-6 rounded-2xl border border-border bg-surface p-5"
			use:enhance={withToast('Document added.', () => (creating = false))}
		>
			<h2 class="font-semibold text-heading">New document</h2>
			<div class="mt-3">{@render fields()}</div>
			<div class="mt-4 flex gap-2">
				<button type="submit" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Add document</button>
				<button type="button" onclick={() => (creating = false)} class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2">Cancel</button>
			</div>
		</form>
	{:else}
		<button
			type="button"
			onclick={() => (creating = true)}
			class="mt-6 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
		>
			+ New document
		</button>
	{/if}

	{#if data.docs.length > 0}
		<ul class="mt-6 space-y-3">
			{#each data.docs as doc (doc.id)}
				<li class="rounded-2xl border border-border bg-surface p-5">
					{#if editingId === doc.id}
						<form method="post" action="?/edit" use:enhance={withToast('Document updated.', () => (editingId = null))}>
							<input type="hidden" name="id" value={doc.id} />
							{@render fields(doc)}
							<div class="mt-4 flex gap-2">
								<button type="submit" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Save</button>
								<button type="button" onclick={() => (editingId = null)} class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2">Cancel</button>
							</div>
						</form>
					{:else}
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-heading">{doc.title}</p>
								<p class="mt-1 text-xs text-muted">
									Triggers on: <span class="font-mono">{doc.keywords}</span>
								</p>
								{#if doc.sourceUrl}
									<a href={doc.sourceUrl} target="_blank" rel="noopener" class="mt-1 block truncate text-xs text-primary hover:underline">{doc.sourceUrl}</a>
								{/if}
							</div>
							<div class="flex shrink-0 gap-1.5">
								<button
									type="button"
									onclick={() => (editingId = doc.id)}
									class="rounded-full border border-border px-3 py-1 text-xs font-semibold text-heading transition hover:bg-surface-2"
								>
									Edit
								</button>
								<form method="post" action="?/remove" use:enhance={withToast('Document removed.')}>
									<input type="hidden" name="id" value={doc.id} />
									<button type="submit" class="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted transition hover:bg-surface-2 hover:text-heading">
										Remove
									</button>
								</form>
							</div>
						</div>
						<p class="mt-3 line-clamp-3 text-sm leading-relaxed whitespace-pre-line text-muted">{doc.body}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<div class="mt-6 rounded-2xl border border-dashed border-border p-8 text-center">
			<p class="font-semibold text-heading">No civics documents yet</p>
			<p class="mx-auto mt-2 max-w-md text-sm text-muted">
				Until one exists, civics questions fall back to the seat duties and census figures that ship
				in code. Add a document to cover registration, key dates, or the manuals.
			</p>
		</div>
	{/if}
	{:else}
		<p class="mt-4 text-sm text-muted">
			The public FAQ. These same answers render on <a href="/faq" class="font-medium text-primary hover:underline">/faq</a>
			and ground the Ask box, so editing one here changes both.
		</p>

		{#snippet faqFields(faq?: { section: string; question: string; answer: string; sortOrder: number })}
			<div class="grid gap-3 sm:grid-cols-[2fr_1fr]">
				<label class="block">
					<span class="text-xs font-medium text-muted">Section</span>
					<input type="text" name="section" required list="faq-sections" value={faq?.section ?? ''} placeholder="Citizens" class={inputClass} />
				</label>
				<label class="block">
					<span class="text-xs font-medium text-muted">Order within section</span>
					<input type="number" name="sortOrder" min="0" value={faq?.sortOrder ?? 0} class={inputClass} />
				</label>
			</div>
			<datalist id="faq-sections">
				{#each sections as section (section)}<option value={section}></option>{/each}
			</datalist>
			<label class="mt-3 block">
				<span class="text-xs font-medium text-muted">Question</span>
				<input type="text" name="question" required value={faq?.question ?? ''} placeholder="How do I follow a leader?" class={inputClass} />
			</label>
			<label class="mt-3 block">
				<span class="text-xs font-medium text-muted">Answer</span>
				<textarea name="answer" rows="4" required class={inputClass}>{faq?.answer ?? ''}</textarea>
			</label>
		{/snippet}

		{#if creatingFaq}
			<form
				method="post"
				action="?/createFaq"
				class="mt-4 rounded-2xl border border-border bg-surface p-5"
				use:enhance={withToast('Question added.', () => (creatingFaq = false))}
			>
				<h2 class="font-semibold text-heading">New question</h2>
				<div class="mt-3">{@render faqFields()}</div>
				<div class="mt-4 flex gap-2">
					<button type="submit" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Add question</button>
					<button type="button" onclick={() => (creatingFaq = false)} class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2">Cancel</button>
				</div>
			</form>
		{:else}
			<button
				type="button"
				onclick={() => (creatingFaq = true)}
				class="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
			>
				+ New question
			</button>
		{/if}

		{#if data.faqs.length > 0}
			<ul class="mt-6 space-y-3">
				{#each data.faqs as faq (faq.id)}
					<li class="rounded-2xl border border-border bg-surface p-5">
						{#if editingFaqId === faq.id}
							<form method="post" action="?/editFaq" use:enhance={withToast('Question updated.', () => (editingFaqId = null))}>
								<input type="hidden" name="id" value={faq.id} />
								{@render faqFields(faq)}
								<div class="mt-4 flex gap-2">
									<button type="submit" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95">Save</button>
									<button type="button" onclick={() => (editingFaqId = null)} class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2">Cancel</button>
								</div>
							</form>
						{:else}
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-xs font-semibold tracking-wide text-muted uppercase">{faq.section}</p>
									<p class="mt-0.5 font-semibold text-heading">{faq.question}</p>
								</div>
								<div class="flex shrink-0 gap-1.5">
									<button
										type="button"
										onclick={() => (editingFaqId = faq.id)}
										class="rounded-full border border-border px-3 py-1 text-xs font-semibold text-heading transition hover:bg-surface-2"
									>
										Edit
									</button>
									<form method="post" action="?/removeFaq" use:enhance={withToast('Question removed.')}>
										<input type="hidden" name="id" value={faq.id} />
										<button type="submit" class="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted transition hover:bg-surface-2 hover:text-heading">
											Remove
										</button>
									</form>
								</div>
							</div>
							<p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted">{faq.answer}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<div class="mt-6 rounded-2xl border border-dashed border-border p-8 text-center">
				<p class="font-semibold text-heading">No FAQ entries</p>
				<p class="mx-auto mt-2 max-w-md text-sm text-muted">
					Seed the shipped set with <span class="font-mono text-xs">bun run db:seed -- --platform-faqs</span>, or add questions here.
				</p>
			</div>
		{/if}
	{/if}
</div>
