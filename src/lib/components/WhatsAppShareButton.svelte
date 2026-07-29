<script lang="ts">
	import { page } from '$app/state';

	// One-tap WhatsApp share of the current page: wa.me opens the app on mobile
	// and WhatsApp Web on desktop, with the message prefilled.
	let { text }: { text: string } = $props();

	const href = $derived(`https://wa.me/?text=${encodeURIComponent(`${text} ${page.url.href}`)}`);
</script>

<a
	{href}
	target="_blank"
	rel="noopener noreferrer"
	class="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-heading transition hover:bg-surface-2"
>
	<svg viewBox="0 0 24 24" fill="currentColor" class="size-4 text-[#25D366]" aria-hidden="true">
		<path
			d="M12 2a9.9 9.9 0 0 0-8.53 15L2 22l5.15-1.35A9.94 9.94 0 1 0 12 2Zm0 18.1a8.07 8.07 0 0 1-4.11-1.13l-.3-.18-3.05.8.81-2.98-.19-.3A8.1 8.1 0 1 1 12 20.1Zm4.44-6.07c-.24-.12-1.44-.71-1.66-.79s-.39-.12-.55.12-.63.79-.77.95-.28.18-.53.06a6.63 6.63 0 0 1-1.94-1.2 7.34 7.34 0 0 1-1.35-1.67c-.14-.24 0-.37.11-.5s.24-.28.37-.42a1.63 1.63 0 0 0 .24-.41.45.45 0 0 0 0-.43c-.06-.12-.55-1.32-.75-1.81s-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.73 2.73 0 0 0-.85 2 4.73 4.73 0 0 0 1 2.52A10.86 10.86 0 0 0 13.1 16.9a4.62 4.62 0 0 0 2.83.61 2.42 2.42 0 0 0 1.58-1.11 2 2 0 0 0 .14-1.11c-.06-.11-.22-.17-.46-.29Z"
		/>
	</svg>
	WhatsApp
</a>
