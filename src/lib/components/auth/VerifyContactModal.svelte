<script lang="ts">
	import { page } from '$app/state';
	import Modal from '$lib/components/Modal.svelte';
	import VerifyOtpForm from './VerifyOtpForm.svelte';

	// Inline replacement for the Email/PhoneInput verify-page navigation: the
	// account and contacts forms open this over the page they're on, so verifying
	// never abandons half-edited fields. `next` chases the page's own ?next= the
	// same way the old Verify links did (e.g. an onboarding gate's destination),
	// and `slug` defaults from the route for leader-scoped verification.
	let {
		open = $bindable(false),
		channel = 'email',
		destination,
		scope = 'account',
		slug = null
	}: {
		open?: boolean;
		channel?: 'email' | 'sms' | 'whatsapp';
		destination: string;
		scope?: string;
		slug?: string | null;
	} = $props();

	const SUBTITLE = {
		email: 'Check your inbox for a verification code and link.',
		sms: 'We texted a code to this number.',
		whatsapp: 'We sent a WhatsApp code to this number.'
	};

	const next = $derived(page.url.searchParams.get('next') ?? page.url.pathname);
	const resolvedSlug = $derived(slug ?? page.params.slug ?? null);
</script>

<Modal bind:open title="Verify {destination}">
	<p class="mt-2 text-sm text-muted">{SUBTITLE[channel]}</p>
	<div class="mt-5">
		<VerifyOtpForm {channel} {destination} {next} {scope} slug={resolvedSlug} autoSend onVerified={() => (open = false)} />
	</div>
</Modal>
