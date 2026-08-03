import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/dashboard';
import { addTemplate, LEVELS, levelTitle, listTemplatesForLevel, removeTemplate, updateTemplate } from '$lib/server/adminPillars';
import { adminActionFailed } from '$lib/server/notifications';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	const title = levelTitle(event.params.level);
	if (!title) error(404, 'Unknown level');

	return { levels: LEVELS, level: event.params.level, levelTitle: title, templates: await listTemplatesForLevel(title) };
};

export const actions: Actions = {
	add: async (event) => {
		const admin = await requireAdmin(event);
		const title = levelTitle(event.params.level);
		if (!title) error(404, 'Unknown level');

		const form = await event.request.formData();
		const templateTitle = String(form.get('title') ?? '').trim();
		const summary = String(form.get('summary') ?? '').trim();
		if (!templateTitle || !summary) return adminActionFailed(admin.domainUser.id, 400, { error: 'A pillar needs both a title and a summary.' });

		await addTemplate(title, templateTitle, summary);
		return { saved: true };
	},

	update: async (event) => {
		const admin = await requireAdmin(event);
		const title = levelTitle(event.params.level);
		if (!title) error(404, 'Unknown level');

		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		const templateTitle = String(form.get('title') ?? '').trim();
		const summary = String(form.get('summary') ?? '').trim();
		if (!templateTitle || !summary) return adminActionFailed(admin.domainUser.id, 400, { error: 'A pillar needs both a title and a summary.' });

		await updateTemplate(id, title, templateTitle, summary);
		return { saved: true };
	},

	remove: async (event) => {
		await requireAdmin(event);
		const title = levelTitle(event.params.level);
		if (!title) error(404, 'Unknown level');

		const form = await event.request.formData();
		const id = Number(form.get('id') ?? 0);
		await removeTemplate(id, title);
		return { saved: true };
	}
};
