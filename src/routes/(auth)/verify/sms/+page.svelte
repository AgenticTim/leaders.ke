<script lang="ts">
	import AuthCard from '$lib/components/auth/AuthCard.svelte';
	import VerifyOtpForm from '$lib/components/auth/VerifyOtpForm.svelte';
	import type { PageProps } from './$types';

	// Full-page host for VerifyOtpForm (the modal host is VerifyContactModal),
	// still needed as a real page for server-side redirects here.
	let { data }: PageProps = $props();
</script>

<AuthCard title="Verify {data.phone}" subtitle="We texted a code to this number">
	<VerifyOtpForm
		channel="sms"
		destination={data.phone}
		next={data.next}
		scope={data.scope}
		slug={data.slug}
		cooldown={data.phoneCooldown}
	/>
</AuthCard>
