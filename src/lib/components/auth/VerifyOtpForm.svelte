<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	// The OTP-entry body of the /verify/[channel] pages, shared by those pages and
	// the verify modals (AuthModal's post-signup step, VerifyContactModal on
	// account/contacts). Posts to the channel's absolute /verify actions so it
	// works from any host page; errors are captured locally. On success the server
	// action redirects to `next` with a flash, which applyAction follows.
	type Channel = 'email' | 'sms' | 'whatsapp';
	const CHANNELS: Record<Channel, { base: string; sendAction: string; fieldName: string; errorKey: string; label: string }> = {
		email: { base: '/verify/email', sendAction: 'sendEmailCode', fieldName: 'email', errorKey: 'emailError', label: 'Enter the verification code' },
		sms: { base: '/verify/sms', sendAction: 'sendPhoneCode', fieldName: 'phone', errorKey: 'phoneError', label: 'Enter the SMS code' },
		whatsapp: { base: '/verify/whatsapp', sendAction: 'sendPhoneCode', fieldName: 'phone', errorKey: 'phoneError', label: 'Enter the WhatsApp code' }
	};

	let {
		channel = 'email',
		destination,
		next = '/dashboard',
		scope = 'account',
		slug = null,
		cooldown = 0,
		autoSend = false,
		onVerified
	}: {
		channel?: Channel;
		/** The address or normalized 254… number being verified. */
		destination: string;
		next?: string;
		scope?: string;
		slug?: string | null;
		/** Seconds left before "Resend code" re-enables (the page's load supplies it). */
		cooldown?: number;
		/** Send the code on mount, for modal hosts, where the verify page's load
		 * (which does the on-arrival send) never runs. The server reuses a still
		 * pending code instead of firing a duplicate on every open. */
		autoSend?: boolean;
		/** Fires just before following the success redirect, so a modal host can close. */
		onVerified?: () => void;
	} = $props();

	const cfg = $derived(CHANNELS[channel]);

	let sendCooldown = $state(cooldown);
	let sendingCode = $state(false);
	let verifyingCode = $state(false);
	let codeError = $state<string | null>(null);
	let sendError = $state<string | null>(null);
	let codeSent = $state(false);

	let sendFormEl: HTMLFormElement | undefined = $state();
	// Marks the next send submit as the automatic on-mount one (carries auto=1 to
	// the server so it reuses a pending code); a deliberate Resend click drops it.
	let autoSubmitting = false;

	$effect(() => {
		if (sendCooldown <= 0) return;
		const t = setInterval(() => {
			sendCooldown = Math.max(0, sendCooldown - 1);
		}, 1000);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (!autoSend) return;
		autoSubmitting = true;
		sendFormEl?.requestSubmit();
	});
</script>

<div class="space-y-2">
	<form
		method="post"
		action="{cfg.base}?/verifyCode"
		class="flex items-end gap-2"
		use:enhance={() => {
			verifyingCode = true;
			codeError = null;
			return async ({ result }) => {
				verifyingCode = false;
				if (result.type === 'failure') {
					codeError = String((result.data as { codeError?: string })?.codeError ?? 'That code is invalid or expired.');
				} else if (result.type === 'redirect') {
					onVerified?.();
					await applyAction(result);
					await invalidateAll();
				} else {
					await applyAction(result);
				}
			};
		}}
	>
		<input type="hidden" name="next" value={next} />
		<input type="hidden" name="scope" value={scope} />
		<input type="hidden" name="slug" value={slug ?? ''} />
		<label class="block flex-1">
			<div class="text-xs font-medium text-muted mb-2">{cfg.label}</div>
			<div class="flex items-stretch">
				<input
					type="text"
					name="code"
					inputmode="numeric"
					maxlength="6"
					placeholder="123456"
					class="px-4 py-2.5 w-full rounded-l-xl border border-border bg-surface text-sm text-heading placeholder:text-muted focus:border-primary focus:ring-0 focus:ring-ring focus:outline-none"
				/>
				<button
					type="submit"
					disabled={verifyingCode}
					class="grid place-items-center px-4 py-2.5  rounded-r-xl bg-primary text-sm font-semibold text-on-primary transition hover:brightness-95 disabled:opacity-50"
				>
					Verify
				</button>
			</div>
		</label>
	</form>
	{#if codeError}
		<p class="mt-1 text-sm text-red-500">{codeError}</p>
	{/if}
	{#if sendError}
		<p class="mt-1 text-sm text-red-500">{sendError}</p>
	{:else if codeSent}
		<p class="mt-1 text-sm text-primary">Code sent.</p>
	{/if}
	<form
		method="post"
		action="{cfg.base}?/{cfg.sendAction}"
		bind:this={sendFormEl}
		use:enhance={({ formData }) => {
			if (!autoSubmitting) formData.delete('auto');
			autoSubmitting = false;
			sendingCode = true;
			sendError = null;
			return async ({ result }) => {
				sendingCode = false;
				if (result.type === 'failure') {
					sendError = String((result.data as Record<string, string>)?.[cfg.errorKey] ?? 'Could not send code');
				} else if (result.type === 'success') {
					// A phone already OTP-verified on the sibling channel gets verified
					// instantly server-side; treat it like a completed verification.
					if ((result.data as { alreadyVerified?: boolean })?.alreadyVerified) {
						onVerified?.();
						await invalidateAll();
						return;
					}
					codeSent = true;
					sendCooldown = Number((result.data as { cooldown?: number })?.cooldown ?? 60);
				}
			};
		}}
	>
		<input type="hidden" name={cfg.fieldName} value={destination} />
		<input type="hidden" name="scope" value={scope} />
		<input type="hidden" name="slug" value={slug ?? ''} />
		<input type="hidden" name="auto" value="1" />
		<button
			type="submit"
			disabled={sendingCode || sendCooldown > 0}
			class="mt-2 rounded-full bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-heading transition hover:brightness-95 disabled:opacity-50"
		>
			{sendCooldown > 0 ? `Resend in ${sendCooldown}s` : 'Resend code'}
		</button>
	</form>
</div>
