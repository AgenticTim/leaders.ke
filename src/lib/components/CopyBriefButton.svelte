<script lang="ts">
	import { toast } from '$lib/stores/toast';

	// Copies a leader's latest coverage as a ready-to-paste WhatsApp message
	// (built server-side, see $lib/server/leaderBrief.ts). On a touch device it
	// hands the same text to WhatsApp directly via wa.me instead, which beats
	// making someone copy and then find the app.
	let {
		slug,
		name,
		class: className = ''
	}: { slug: string; name: string; class?: string } = $props();

	let busy = $state(false);

	async function fetchBrief(): Promise<{ text: string; count: number } | null> {
		const res = await fetch(`/api/leader-brief?slug=${encodeURIComponent(slug)}`);
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
	async function copyOnDesktop(event: MouseEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		try {
			let brief: { text: string; count: number } | null = null;
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
			if (brief) {
				toast.success(brief.text, { title: `Copied ${brief.count} stories about ${name}` });
			}
		} catch {
			toast.error('Could not copy the brief. Try again.');
		} finally {
			busy = false;
		}
	}

	// Touch: open WhatsApp with the message prefilled. The window is opened
	// BEFORE the await so the tap still counts as a user gesture (a popup opened
	// after an await is blocked), then pointed at wa.me once the text arrives.
	async function shareOnTouch(event: MouseEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
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
		} finally {
			busy = false;
		}
	}

	function onClick(event: MouseEvent) {
		const touch = !window.matchMedia('(hover: hover)').matches;
		return touch ? shareOnTouch(event) : copyOnDesktop(event);
	}
</script>

<!-- relative z-10: inside LeaderCard this sits above the card's stretched link
(after:absolute after:inset-0), which would otherwise swallow the click. -->
<button
	type="button"
	onclick={onClick}
	disabled={busy}
	aria-label="Copy a WhatsApp brief of {name}'s latest news"
	title="Copy a WhatsApp brief of {name}'s latest news"
	class="relative z-10 inline-flex shrink-0 items-center rounded-full p-0.5 align-middle text-[#25D366] transition hover:bg-surface-2 disabled:cursor-wait disabled:opacity-50 {className}"
>
	<svg viewBox="0 0 24 24" fill="currentColor" class="size-4" aria-hidden="true">
		<path
			d="M12 2a9.9 9.9 0 0 0-8.53 15L2 22l5.15-1.35A9.94 9.94 0 1 0 12 2Zm0 18.1a8.07 8.07 0 0 1-4.11-1.13l-.3-.18-3.05.8.81-2.98-.19-.3A8.1 8.1 0 1 1 12 20.1Zm4.44-6.07c-.24-.12-1.44-.71-1.66-.79s-.39-.12-.55.12-.63.79-.77.95-.28.18-.53.06a6.63 6.63 0 0 1-1.94-1.2 7.34 7.34 0 0 1-1.35-1.67c-.14-.24 0-.37.11-.5s.24-.28.37-.42a1.63 1.63 0 0 0 .24-.41.45.45 0 0 0 0-.43c-.06-.12-.55-1.32-.75-1.81s-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.73 2.73 0 0 0-.85 2 4.73 4.73 0 0 0 1 2.52A10.86 10.86 0 0 0 13.1 16.9a4.62 4.62 0 0 0 2.83.61 2.42 2.42 0 0 0 1.58-1.11 2 2 0 0 0 .14-1.11c-.06-.11-.22-.17-.46-.29Z"
		/>
	</svg>
</button>
