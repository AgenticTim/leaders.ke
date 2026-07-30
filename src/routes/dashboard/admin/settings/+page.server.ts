import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { platformSettings } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { getPlatformSettings } from '$lib/server/settings';
import { NEWS_SOURCES } from '$lib/server/newsIngest';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	return { settings: await getPlatformSettings(), newsSourceOptions: NEWS_SOURCES };
};

export const actions: Actions = {
	save: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();

		const otpCooldownSeconds = Number(form.get('otpCooldownSeconds'));
		const otpDailyCap = Number(form.get('otpDailyCap'));
		const pageSize = Number(form.get('pageSize'));
		const requiredTeamManagers = Number(form.get('requiredTeamManagers'));
		const requiredSignoffs = Number(form.get('requiredSignoffs'));
		const requireIebcForVerification = form.get('requireIebcForVerification') === 'on';
		const requireEmailVerification = form.get('requireEmailVerification') === 'on';
		const requirePhoneVerification = form.get('requirePhoneVerification') === 'on';
		const platformSystemPrompt = String(form.get('platformSystemPrompt') ?? '').trim();
		const leaderSystemPrompt = String(form.get('leaderSystemPrompt') ?? '').trim();
		const maxGroundingChars = Number(form.get('maxGroundingChars'));
		const guestAskLifetimeLimit = Number(form.get('guestAskLifetimeLimit'));
		const userAskDailyLimit = Number(form.get('userAskDailyLimit'));
		const aiChatCostCredits = Number(form.get('aiChatCostCredits'));

		// Lifetime invite limits live on the Packages page (part of what a package buys).
		for (const [label, value] of [
			['Cooldown', otpCooldownSeconds],
			['Daily cap', otpDailyCap],
			['Page size', pageSize],
			['Verified team members', requiredTeamManagers],
			['Sign-offs required', requiredSignoffs],
			['Max grounding characters', maxGroundingChars],
			['Guest AI Chat lifetime limit', guestAskLifetimeLimit],
			['Signed-in AI Chat daily limit', userAskDailyLimit],
			['AI Chat credits per answer', aiChatCostCredits]
		] as const) {
			if (!Number.isInteger(value) || value < 1) return fail(400, { error: `${label} must be a whole number of at least 1.` });
		}
		if (!platformSystemPrompt) return fail(400, { error: 'The platform system prompt cannot be empty.' });
		if (!leaderSystemPrompt) return fail(400, { error: 'The leader system prompt cannot be empty.' });

		// Comma/whitespace-separated words, normalized to lowercase and deduped.
		// These block new leader slugs only — existing slugs are untouched.
		const blockedSlugs = [
			...new Set(
				String(form.get('blockedSlugs') ?? '')
					.split(/[\s,]+/)
					.map((s) => s.trim().toLowerCase())
					.filter(Boolean)
			)
		];

		await db
			.update(platformSettings)
			.set({
				otpCooldownSeconds,
				otpDailyCap,
				blockedSlugs,
				pageSize,
				requiredTeamManagers,
				requiredSignoffs,
				requireIebcForVerification,
				requireEmailVerification,
				requirePhoneVerification,
				platformSystemPrompt,
				leaderSystemPrompt,
				maxGroundingChars,
				guestAskLifetimeLimit,
				userAskDailyLimit,
				aiChatCostCredits,
				updatedAt: new Date()
			})
			.where(eq(platformSettings.id, 1));

		return { saved: true };
	},

	// One toggle per news source (see NEWS_SOURCES in newsIngest.ts). Same
	// checkbox-omits-itself-when-unchecked issue as the Packages perk grid: a
	// hidden "false" fallback after each checkbox in the form carries the off
	// state, since the checkbox itself is simply absent from FormData then.
	saveNewsSources: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const newsSources: Record<string, boolean> = {};
		for (const id of Object.keys(NEWS_SOURCES)) {
			newsSources[id] = form.get(id) === 'true';
		}
		await db.update(platformSettings).set({ newsSources, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
		return { saved: true };
	}
};
