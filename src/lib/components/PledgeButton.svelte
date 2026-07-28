<script lang="ts">
	import { enhance } from '$app/forms';

	// One-click pledge to a candidate shown on a ballot result page. Any visitor's
	// own identity (see resolveVoterIdentity), independent of whoever cast this
	// particular simulated ballot. Posts to the page's own "?/pledge" action.
	let {
		campaignId,
		candidateName,
		isPledged = false
	}: {
		campaignId: number;
		candidateName: string;
		/** Server-resolved existing pledge (survives a refresh, unlike justPledged). */
		isPledged?: boolean;
	} = $props();

	let justPledged = $state(false);
	const pledged = $derived(isPledged || justPledged);
	let pledging = $state(false);
</script>

{#if pledged}
	<p class="rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-center text-xs font-semibold text-on-primary">
		Pledged ✓
	</p>
{:else}
	<form
		method="post"
		action="?/pledge"
		use:enhance={() => {
			pledging = true;
			return async ({ result, update }) => {
				pledging = false;
				if (result.type === 'success') justPledged = true;
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="campaignId" value={campaignId} />
		<button
			type="submit"
			disabled={pledging}
			aria-label="Pledge to vote for {candidateName}"
			class="rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary hover:text-on-primary disabled:opacity-60"
		>
			{pledging ? 'Pledging…' : 'Pledge'}
		</button>
	</form>
{/if}
