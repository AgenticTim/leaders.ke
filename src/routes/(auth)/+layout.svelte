<script lang="ts">
	let { children } = $props();
</script>

<!-- Centered container shared by every small auth form. Nests inside the root layout,
     so the site Header/footer stay available; the brand link doubles as a route home. -->
<div class="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
	{@render children()}
</div>
