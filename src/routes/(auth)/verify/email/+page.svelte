<script lang="ts">
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import VerifyOtpForm from '$lib/components/auth/VerifyOtpForm.svelte';
	import type { PageProps } from './$types';

	// Full-page host for VerifyOtpForm (the modal hosts are AuthModal and
	// VerifyContactModal), still needed as a real page for the email's own
	// click-through link (?linkToken) and server-side redirects here.
	let { data }: PageProps = $props();
</script>

<AuthCard title="Verify {data.email}" subtitle="Check your inbox for a verification code and link">
	<VerifyOtpForm
		destination={data.email}
		next={data.next}
		scope={data.scope}
		slug={data.slug}
		cooldown={data.emailCooldown}
	/>
</AuthCard>
