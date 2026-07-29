<script lang="ts">
	import { page } from '$app/state';

	// Native share sheet where available (mobile browsers); copy-to-clipboard
	// fallback everywhere else (most desktop browsers).
	let { title }: { title: string } = $props();
	let copied = $state(false);

	async function share() {
		const url = page.url.href;
		if (navigator.share) {
			try {
				await navigator.share({ title, url });
			} catch {
				// User dismissed the native share sheet, nothing to do.
			}
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard blocked, nothing else to fall back to.
		}
	}
</script>

<button
	type="button"
	onclick={share}
	class="inline-flex items-center gap-1.5 rounded-full border border-border px-3 sm:px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2"
>
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-4">
		<circle cx="18" cy="5" r="3" />
		<circle cx="6" cy="12" r="3" />
		<circle cx="18" cy="19" r="3" />
		<path stroke-linecap="round" d="M8.6 10.5 15.4 6.5M8.6 13.5l6.8 4" />
	</svg>
	{copied ? 'Link copied!' : 'Share'}
</button>
