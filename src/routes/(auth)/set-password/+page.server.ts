import { fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) redirect(302, '/login');
	const [credential] = await db
		.select({ id: account.id })
		.from(account)
		.where(and(eq(account.userId, event.locals.user.id), eq(account.providerId, 'credential')));
	// Already has a password: this route isn't for them, send them to change-password instead.
	if (credential) redirect(302, '/change-password');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const newPassword = form.get('newPassword')?.toString() ?? '';

		try {
			await auth.api.setPassword({
				body: { newPassword },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { message: error.message || 'Could not set password' });
			return fail(500, { message: 'Unexpected error' });
		}

		return { success: true };
	}
};
