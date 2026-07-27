<script lang="ts">
	import { enhance } from '$app/forms';
	import Pagination from '$lib/components/admin/Pagination.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
	const inviteTotalPages = $derived(Math.max(1, Math.ceil(data.inviteTotal / data.pageSize)));
	const notifTotalPages = $derived(Math.max(1, Math.ceil(data.notifTotal / data.pageSize)));

	const roleLabel = (role: string) => (role === 'manager' ? 'Manager' : role === 'ambassador' ? 'Ambassador' : 'Follower');
</script>

<svelte:head><title>Notifications — vote.ke</title></svelte:head>

<div>
	<h1 class="text-xl font-bold text-heading">Notifications</h1>
	<p class="mt-1 text-sm text-muted">Invites to join a campaign, and updates on your own account.</p>

	{#if form?.error}
		<div class="mt-4 rounded-xl border border-border bg-surface-2 p-4 text-sm font-medium text-heading">
			{form.error}
		</div>
	{/if}

	{#if data.invites.length > 0}
		<h2 class="mt-6 text-sm font-semibold text-heading">Invites</h2>
		<ul class="mt-3 space-y-3">
			{#each data.invites as invite (invite.token)}
				<li class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5">
					<div class="min-w-0">
						<p class="font-semibold text-heading">
							<a href={invite.leaderPath} class="hover:text-primary">{invite.leaderName}</a>
							<span class="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
								{roleLabel(invite.role)}
							</span>
						</p>
						<p class="text-sm text-muted">{invite.positionTitle}, {invite.region}</p>
						<p class="mt-1 text-xs text-muted">Invited {dateFmt.format(new Date(invite.createdAt))}</p>
					</div>
					<form method="post" action="?/accept" use:enhance>
						<input type="hidden" name="token" value={invite.token} />
						<button
							type="submit"
							class="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-95"
						>
							Accept
						</button>
					</form>
				</li>
			{/each}
		</ul>
		<Pagination page={data.invitePage} totalPages={inviteTotalPages} total={data.inviteTotal} itemLabel="invites" href={(p) => `?invitePage=${p}&page=${data.page}`} />
	{/if}

	<h2 class="mt-8 text-sm font-semibold text-heading">History</h2>
	{#if data.notifications.length > 0}
		<ul class="mt-3 space-y-3">
			{#each data.notifications as item (item.id)}
				<li class="rounded-2xl border border-border bg-surface p-5 text-sm">
					<p class="font-semibold text-heading">{item.title}</p>
					<p class="mt-1 whitespace-pre-line text-muted [&_a]:font-semibold [&_a]:text-primary [&_a]:underline">{@html item.body}</p>
					<p class="mt-2 text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p>
				</li>
			{/each}
		</ul>
		<Pagination page={data.page} totalPages={notifTotalPages} total={data.notifTotal} itemLabel="notifications" href={(p) => `?page=${p}&invitePage=${data.invitePage}`} />
	{:else if data.invites.length === 0}
		<div class="mt-3 rounded-2xl border border-dashed border-border p-8 text-center">
			<p class="font-semibold text-heading">Nothing here yet</p>
			<p class="mx-auto mt-2 max-w-md text-sm text-muted">
				Campaign invites and account updates (verification/claim decisions) show up here.
			</p>
		</div>
	{:else}
		<p class="mt-3 text-sm text-muted">No notifications yet.</p>
	{/if}
</div>
