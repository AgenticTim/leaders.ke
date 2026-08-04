<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let addingFaq = $state(false);
	let uploading = $state(false);
	let faqQuestion = $state('');
	let faqAnswer = $state('');
	let fileInputEl: HTMLInputElement | undefined = $state();
	const MAX_UPLOAD_MB = 5;
	let fileTooLarge = $state(false);
	let hasFile = $state(false);

	let linkUrl = $state('');
	let fetchingLink = $state(false);
	let savingReview = $state(false);
	// Scroll-syncs the reviewForm's highlight backdrop to the real textarea
	// (only one review is ever open at a time, so one shared ref is enough),
	// without this the red span can sit far down in a long document, past
	// what's visible in the ~8-row textarea, and never scroll into view since
	// the backdrop is a separate, otherwise-static layer.
	let reviewBackdropEl: HTMLDivElement | undefined = $state();
	let reviewTextareaEl: HTMLTextAreaElement | undefined = $state();

	// The one open review: a not-yet-saved file/link preview, or an existing
	// document opened for editing (clicking its title in the list). Only one at a
	// time: opening another replaces whichever was open. `mode` picks the save
	// action and which hidden fields go with it (see the reviewForm snippet).
	type Review =
		| { mode: 'document'; title: string; content: string; sourceUrl: string; mimeType: string }
		| { mode: 'link'; kind: 'youtube' | 'link'; title: string; content: string; sourceUrl: string }
		| { mode: 'edit'; id: number; title: string; content: string };
	let review = $state<Review | null>(null);

	// Live usage against the per-question grounding cap (see load()), purely
	// informational (the progress bar at the bottom of the page), never blocks
	// saving: the actual enforcement is groundingText() silently trimming
	// whatever's over budget at ask-time, not this tab.
	const knowledgeFull = $derived(data.knowledgeUsage.used >= data.knowledgeUsage.cap);
	const usagePct = $derived(Math.min(100, Math.round((data.knowledgeUsage.used / data.knowledgeUsage.cap) * 100)));

	// How much budget is available for a given review's content: cap minus
	// everything else already stored. Editing an existing document excludes
	// that document's own current stored length first (it's being replaced,
	// not added on top of). Drives the red highlight over whatever part of the
	// textarea's content won't fit (see the reviewForm snippet), informational
	// only, saving past it is still allowed, it just won't all reach the AI.
	function availableFor(r: Review): number {
		const excludeExisting = r.mode === 'edit' ? (data.documents.find((d) => d.id === r.id)?.text.length ?? 0) : 0;
		return data.knowledgeUsage.cap - data.knowledgeUsage.used + excludeExisting;
	}

	$effect(() => {
		if (!form || !('previewed' in form) || !form.previewed) return;
		const p = form.preview;
		review =
			p.kind === 'document'
				? { mode: 'document', title: p.title, content: p.content, sourceUrl: p.sourceUrl, mimeType: p.mimeType }
				: { mode: 'link', kind: p.kind, title: p.title, content: p.content, sourceUrl: p.sourceUrl };
	});

	// Jumps the textarea to where the content starts overflowing the remaining
	// budget the moment a review opens, so the red highlight is visible without
	// having to scroll and hunt for it in a long document. Reads `.content`/
	// `available` inside untrack() so this only fires when a *new* review opens
	// (review/reviewTextareaEl reference changes), not on every keystroke while
	// editing (which would otherwise yank the scroll position while typing).
	$effect(() => {
		if (!review || !reviewTextareaEl) return;
		const el = reviewTextareaEl;
		untrack(() => {
			const r = review;
			if (!r) return;
			const avail = availableFor(r);
			if (r.content.length <= avail) return;
			queueMicrotask(() => {
				const ratio = avail / r.content.length;
				const top = Math.max(0, ratio * (el.scrollHeight - el.clientHeight) - 40);
				el.scrollTop = top;
				if (reviewBackdropEl) reviewBackdropEl.scrollTop = top;
			});
		});
	});
</script>

{#snippet reviewForm(r: Review)}
	{@const available = availableFor(r)}
	{@const tooBig = r.content.length > available}
	<div class="mt-4 rounded-xl border border-border bg-surface-2 p-4">
		<p class="text-xs font-semibold text-muted uppercase">
			{r.mode === 'edit' ? 'Edit document' : r.mode === 'link' && r.kind === 'youtube' ? 'YouTube, review before saving' : 'Review before saving'}
		</p>
		<label class="mt-2 block">
			<span class="text-xs font-medium text-muted">Title</span>
			<input
				type="text"
				value={r.title}
				oninput={(e) => (r.title = e.currentTarget.value)}
				class="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
			/>
		</label>
		<label class="mt-2 block">
			<span class="text-xs font-medium text-muted">Extracted text (edit freely before saving)</span>
			<!-- Overlay trick: a backdrop div (same font/padding, invisible text)
			     sits behind the real textarea, whose background is transparent so
			     the backdrop's red span shows through exactly where the textarea's
			     characters overflow the remaining context budget. The textarea
			     itself stays a plain, fully-editable text box on top. -->
			<div class="relative mt-1">
				<div
					bind:this={reviewBackdropEl}
					aria-hidden="true"
					class="pointer-events-none absolute inset-0 overflow-hidden rounded-xl border border-transparent bg-surface px-4 py-2 text-sm whitespace-pre-wrap break-words text-transparent"
				>{r.content.slice(0, Math.max(0, available))}<span class="bg-red-300/70">{r.content.slice(Math.max(0, available))}</span></div>
				<textarea
					bind:this={reviewTextareaEl}
					value={r.content}
					oninput={(e) => (r.content = e.currentTarget.value)}
					onscroll={(e) => {
						if (reviewBackdropEl) {
							reviewBackdropEl.scrollTop = e.currentTarget.scrollTop;
							reviewBackdropEl.scrollLeft = e.currentTarget.scrollLeft;
						}
					}}
					rows="8"
					class="relative w-full resize-none rounded-xl border border-border bg-transparent px-4 py-2 text-sm text-heading focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				></textarea>
			</div>
		</label>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if r.mode === 'edit'}
				<form
					method="post"
					action="?/updateDocument"
					use:enhance={() => {
						savingReview = true;
						return async ({ result, update }) => {
							savingReview = false;
							if (result.type === 'success') review = null;
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="id" value={r.id} />
					<input type="hidden" name="title" value={r.title} />
					<input type="hidden" name="content" value={r.content} />
					<button
						type="submit"
						disabled={!r.title.trim() || !r.content.trim() || savingReview}
						class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
					>
						{savingReview ? 'Saving…' : 'Save changes'}
					</button>
				</form>
			{:else}
				<form
					method="post"
					action="?/saveDocument"
					use:enhance={() => {
						savingReview = true;
						return async ({ result, update }) => {
							savingReview = false;
							if (result.type === 'success') {
								review = null;
								linkUrl = '';
								hasFile = false;
								if (fileInputEl) fileInputEl.value = '';
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="title" value={r.title} />
					<input type="hidden" name="content" value={r.content} />
					<input type="hidden" name="sourceUrl" value={r.sourceUrl} />
					<input type="hidden" name="mimeType" value={r.mode === 'document' ? r.mimeType : 'text/plain'} />
					<button
						type="submit"
						disabled={!r.title.trim() || !r.content.trim() || savingReview}
						class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
					>
						{savingReview ? 'Saving…' : 'Save context'}
					</button>
				</form>
			{/if}
			{#if tooBig}
				<p class="mt-1 text-xs font-medium text-amber-500">
					The part highlighted in red will be trimmed to fit your context limit.
				</p>
			{/if}
			<button
				type="button"
				onclick={() => (review = null)}
				class="ml-auto rounded-full border border-border bg-surface px-5 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2"
			>
				{r.mode === 'edit' ? 'Cancel' : 'Discard'}
			</button>
		</div>
	</div>
{/snippet}

<svelte:head><title>Knowledge: vote.ke</title></svelte:head>

<div>
	<h2 class="text-xl font-bold text-heading">Knowledge</h2>
	<p class="text-sm text-muted">What the AI Chat feature knows and answers from.</p>

	<!-- Friendly, plain-language framing up front, this is the single place most
	     leaders/managers will misjudge or fear the AI feature, so it's addressed
	     before any form, not buried in a tooltip. -->
	<div class="mt-4 rounded-2xl border border-border bg-surface-2 p-5 text-sm text-muted">
		<p class="font-semibold text-heading">How this works, in plain terms</p>
		<ul class="mt-2 list-disc space-y-1 pl-5">
			<li>Citizens can ask questions and get instant answers on your public profile and campaign page.</li>
			<li>AI generates answers from the content on your profile and this tab. Never anything it wasn't given.</li>
			<li>It never invents facts, promises, or positions. If something isn't written here, it says so and points citizens to follow the campaign instead.</li>
			<li>All content you upload here only ever surfaces as an AI-written answer to a citizen's specific question. It is never published or shared elsewhere.</li>
		</ul>
	</div>

	{#if form?.error}
		<div class="mt-4 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">{form.error}</div>
	{/if}

	<!-- FAQ builder -->
	<div class="mt-6 rounded-2xl border border-border bg-surface p-5">
		<h3 class="font-semibold text-heading">Frequently asked questions</h3>
		<p class="mt-1 text-sm text-muted">Answer the questions citizens ask most - the AI leans on these first.</p>

		{#if data.faqs.length === 0}
			<p class="mt-3 text-sm text-muted">No FAQs yet.</p>
		{:else}
			<ul class="mt-3 space-y-2">
				{#each data.faqs as faq (faq.id)}
					<li class="rounded-xl bg-surface-2 p-4 text-sm">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium text-heading">{faq.question}</p>
								<p class="mt-1 text-muted">{faq.answer}</p>
							</div>
							<form
								method="post"
								action="?/removeFaq"
								use:enhance={() => async ({ update }) => update()}
							>
								<input type="hidden" name="id" value={faq.id} />
								<button type="submit" class="shrink-0 text-xs font-semibold text-muted hover:text-heading">Remove</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			method="post"
			action="?/addFaq"
			class="mt-4 space-y-3 border-t border-border pt-4"
			use:enhance={() => {
				addingFaq = true;
				return async ({ result, update }) => {
					addingFaq = false;
					if (result.type === 'success') {
						faqQuestion = '';
						faqAnswer = '';
					}
					await update({ reset: false });
				};
			}}
		>
			<label class="block">
				<span class="text-sm font-medium text-heading">Question</span>
				<input
					type="text"
					name="question"
					bind:value={faqQuestion}
					placeholder="What is your plan for youth unemployment?"
					class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				/>
			</label>
			<label class="block">
				<span class="text-sm font-medium text-heading">Answer</span>
				<textarea
					name="answer"
					bind:value={faqAnswer}
					rows="3"
					placeholder="Write the answer exactly as you'd want a citizen to read it. The AI may reuse this wording directly."
					class="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				></textarea>
			</label>
			<button
				type="submit"
				disabled={!faqQuestion.trim() || !faqAnswer.trim() || addingFaq}
				class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
			>
				{addingFaq ? 'Adding…' : 'Add FAQ'}
			</button>
		</form>
	</div>

	<!-- Document uploads -->
	<div class="mt-6 rounded-2xl border border-border bg-surface p-5">
		<h3 class="font-semibold text-heading">Source documents</h3>
		
		<ul class="mt-1 ml-1 text-sm text-muted list-disc list-inside">
			<li>Upload manifestos, policy briefs, PDF, .txt or .md - each under 5 MB.</li>
			<li>Text is pulled out automatically and feeds the AI right away.</li>
			<li>Files that are mostly textual and relevant tend to perform better</li>
			<li>Scanned files with no real text layer won't have anything to extract</li>
		</ul>

		{#if data.documents.length === 0}
			<p class="mt-3 text-sm text-muted">No documents yet.</p>
		{:else}
			<ul class="mt-3 space-y-2">
				{#each data.documents as doc (doc.id)}
					<li class="rounded-xl bg-surface-2 p-4 text-sm">
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<button
									type="button"
									onclick={() =>
										(review =
											review?.mode === 'edit' && review.id === doc.id
												? null
												: { mode: 'edit', id: doc.id, title: doc.title, content: doc.text })}
									class="text-left font-medium text-heading hover:underline"
								>
									{doc.title}
								</button>
								<p class="mt-0.5 text-xs text-muted">
									{doc.mimeType}
									{#if doc.textReady}· feeding the AI{:else}· not readable by the AI yet{/if}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-3">
								<a href={doc.fileUrl} target="_blank" rel="noopener" class="text-xs font-semibold text-muted hover:text-heading">Source</a>
								<form
									method="post"
									action="?/removeDocument"
									use:enhance={() => async ({ update }) => update()}
								>
									<input type="hidden" name="id" value={doc.id} />
									<button type="submit" class="text-xs font-semibold text-muted hover:text-heading">Remove</button>
								</form>
							</div>
						</div>
						{#if review?.mode === 'edit' && review.id === doc.id}
							{@render reviewForm(review)}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<form
			method="post"
			action="?/previewDocument"
			enctype="multipart/form-data"
			class="mt-4 border-t border-border pt-4"
			use:enhance={() => {
				uploading = true;
				review = null;
				return async ({ update }) => {
					uploading = false;
					await update({ reset: false });
				};
			}}
		>
			<label class="block">
				<span class="text-sm font-medium text-heading">File</span>
				<div class="mt-1.5 flex flex-wrap items-center justify-between gap-3">
					<input
						type="file"
						name="file"
						accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
						bind:this={fileInputEl}
						onchange={() => {
							const chosen = fileInputEl?.files?.[0];
							hasFile = !!chosen;
							fileTooLarge = !!chosen && chosen.size > MAX_UPLOAD_MB * 1024 * 1024;
						}}
						class="block flex-1 text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-on-primary"
					/>
					<button
						type="submit"
						disabled={!hasFile || uploading || fileTooLarge}
						class="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-60"
					>
						{uploading ? 'Uploading…' : 'Upload document'}
					</button>
				</div>
				{#if fileTooLarge}
					<p class="mt-1.5 text-xs font-medium text-red-600">That file is over {MAX_UPLOAD_MB} MB. Choose a smaller one.</p>
				{/if}
			</label>
		</form>

		{#if review?.mode === 'document'}
			{@render reviewForm(review)}
		{/if}

		<!-- From a link: fetches and shows the extracted text for review. Nothing is
		     saved until the team confirms, since a page's text can come out messy and
		     is worth a glance before it becomes something the AI quotes from. -->
		<div class="mt-6 border-t border-border pt-4">
			<h4 class="text-sm font-semibold text-heading">From a link</h4>
			<p class="mt-1 text-sm text-muted">
				Paste an article, manifesto page, or YouTube video. YouTube links pull the title, description, and a
				transcript when one is available.
			</p>
			<form
				method="post"
				action="?/previewLink"
				class="mt-3 flex flex-col gap-2 sm:flex-row"
				use:enhance={() => {
					fetchingLink = true;
					review = null;
					return async ({ update }) => {
						fetchingLink = false;
						await update({ reset: false });
					};
				}}
			>
				<input
					type="url"
					name="url"
					bind:value={linkUrl}
					placeholder="https://…"
					class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				/>
				<button
					type="submit"
					disabled={!linkUrl.trim() || fetchingLink}
					class="shrink-0 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-heading transition hover:bg-surface-2 disabled:opacity-60"
				>
					{fetchingLink ? 'Fetching…' : 'Fetch'}
				</button>
			</form>

			{#if review?.mode === 'link'}
				{@render reviewForm(review)}
			{/if}
		</div>
	</div>

	<div class="mt-6">
		<div class="flex items-center justify-between text-xs font-medium text-muted">
			<span>Context used</span>
			<span>{data.knowledgeUsage.used.toLocaleString()} / {data.knowledgeUsage.cap.toLocaleString()} characters</span>
		</div>
		<div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
			<div class="h-full rounded-full {knowledgeFull ? 'bg-red-600' : 'bg-primary'}" style="width: {usagePct}%"></div>
		</div>
	</div>
</div>
