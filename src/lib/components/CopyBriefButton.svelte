<script lang="ts">
	import { toast } from '$lib/stores/toast';
	import { tooltip } from '$lib/effects';
	import NewsIcon from '$lib/components/svgs/NewsIcon.svelte';
	import WhatsappIcon from '$lib/components/svgs/WhatsappIcon.svelte';

	// A leader's latest coverage as a ready-to-paste WhatsApp message (built
	// server-side, see $lib/server/leaderBrief.ts), either handed straight to
	// WhatsApp or copied to the clipboard.
	//
	// `action` picks which, and the glyph follows it: 'share' opens wa.me behind
	// the WhatsApp mark, 'copy' writes to the clipboard behind a news icon. The
	// news feed shows both side by side; a leader card shows copy alone.
	// `slug` accepts either a bare slug or a leader path ("/william-ruto"), so
	// callers can pass whichever they already hold.
	let {
		slug,
		name,
		action = 'copy',
		class: className = ''
	}: { slug: string; name: string; action?: 'share' | 'copy'; class?: string } = $props();

	const cleanSlug = $derived(slug.replace(/^\//, ''));
	const label = $derived(
		action === 'share'
			? `Send ${name}'s latest news to WhatsApp`
			: `Copy a WhatsApp brief of ${name}'s latest news`
	);

	let busy = $state(false);

	// The confirmation shows the AI summary alone, truncated: the full brief is
	// five headlines plus a link, which makes for an unreadably tall toast.
	const TOAST_MAX = 180;
	function confirm(brief: { count: number; tldr: string | null }) {
		const summary = brief.tldr
			? brief.tldr.length > TOAST_MAX
				? `${brief.tldr.slice(0, TOAST_MAX - 1).trimEnd()}…`
				: brief.tldr
			: 'Paste it into a chat to share.';
		toast.success(summary, { title: `Copied ${brief.count} stories about ${name}`, duration: 10000 });
	}

	async function fetchBrief(): Promise<{ text: string; count: number; tldr: string | null } | null> {
		const res = await fetch(`/api/leader-brief?slug=${encodeURIComponent(cleanSlug)}`);
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			toast.info(body.error ?? `No recent news for ${name}.`);
			return null;
		}
		return res.json();
	}

	// Safari revokes clipboard permission once an await breaks the user-gesture
	// context, so the PROMISE goes into ClipboardItem and the fetch resolves
	// inside it. write() is called synchronously in the handler; the plain
	// writeText path is the fallback for browsers without ClipboardItem.
	async function copy() {
		try {
			let brief: { text: string; count: number; tldr: string | null } | null = null;
			if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
				const payload = fetchBrief().then((b) => {
					brief = b;
					return new Blob([b?.text ?? ''], { type: 'text/plain' });
				});
				await navigator.clipboard.write([new ClipboardItem({ 'text/plain': payload })]);
			} else {
				brief = await fetchBrief();
				if (brief) await navigator.clipboard.writeText(brief.text);
			}
			if (brief) confirm(brief);
		} catch {
			toast.error('Could not copy the brief. Try again.');
		}
	}

	// wa.me opens the app on mobile and WhatsApp Web on desktop. The window is
	// opened BEFORE the await so the click still counts as a user gesture (a
	// popup opened after an await is blocked), then pointed at wa.me once the
	// text arrives.
	async function share() {
		const win = window.open('', '_blank');
		try {
			const brief = await fetchBrief();
			if (!brief) {
				win?.close();
				return;
			}
			const url = `https://wa.me/?text=${encodeURIComponent(brief.text)}`;
			if (win) win.location.href = url;
			else window.location.href = url;
		} catch {
			win?.close();
			toast.error('Could not build the brief. Try again.');
		}
	}

	async function onClick(event: MouseEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		try {
			await (action === 'share' ? share() : copy());
		} finally {
			busy = false;
		}
	}
</script>

<!-- relative z-10: inside LeaderCard this sits above the card's stretched link
(after:absolute after:inset-0), which would otherwise swallow the click. -->
<button
	type="button"
	onclick={onClick}
	disabled={busy}
	aria-label={label}
	use:tooltip={label}
	class="relative z-10 inline-flex shrink-0 items-center rounded-full p-0.5 align-middle text-muted transition disabled:cursor-wait disabled:opacity-50 {action ===
	'share'
		? 'hover:text-[#25D366]'
		: 'hover:text-primary'} {className}"
>
	{#if action === 'share'}
		<WhatsappIcon size={20} />
	{:else}
		<NewsIcon class="size-6" />
	{/if}
</button>
