<script lang="ts">
	// Platform inbox: threads from the header's site-wide Ask box. The list/thread
	// UI itself is ChatInbox, shared with the campaign Inbox tab, only the wiring
	// (which SSE scope, how paging URLs are built, what a reply means here) lives
	// on this page.
	import ChatInbox from '$lib/components/ChatInbox.svelte';
	import { toast } from '$lib/stores/toast';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
	const awaiting = $derived(data.threads.filter((t) => t.awaitingReply).length);
</script>

<svelte:head><title>Platform inbox · Admin</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">
		Platform inbox <span class="text-sm font-normal text-muted">({data.total}{#if awaiting > 0} · {awaiting} awaiting{/if})</span>
	</h1>
	<p class="mt-1 text-sm text-muted">
		Questions asked from the site-wide Ask box. Ones the AI couldn't answer (asker over their limit,
		or no answer available) are waiting for your reply.
	</p>

	<ChatInbox
		threads={data.threads}
		page={data.page}
		{totalPages}
		total={data.total}
		pageHref={(p) => `?page=${p}`}
		eventsUrl="/api/chat/events?scope=platform&role=team"
		teamLabel="vote.ke team"
		itemLabel="threads"
		emptyText="No platform questions yet, questions asked from the sparkle button in the header show up here."
		onReplied={(result) => {
			if (result.type === 'failure') toast.error(String(result.data?.error ?? 'Could not send reply.'));
			else if (result.type === 'success') {
				// A guest asker has no account to notify, say so, rather than
				// leaving the admin assuming the reply reached someone.
				toast.success(
					result.data?.notified
						? 'Reply sent. The citizen was notified by email.'
						: 'Reply saved. This asker was a guest, so they will only see it when they next open the Ask panel on this device.'
				);
			}
		}}
	/>
</div>
