import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { platformSettings } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { getPlatformSettings } from '$lib/server/settings';
import { adminActionFailed } from '$lib/server/notifications';
import { NEWS_SOURCES, ingestNews } from '$lib/server/newsIngest';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	return { settings: await getPlatformSettings(), newsSourceOptions: NEWS_SOURCES };
};

export const actions: Actions = {
	save: async (event) => {
		const admin = await requireAdmin(event);
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
		const askMaxChars = Number(form.get('askMaxChars'));
		// 0 is meaningful here (disables follow-up memory), so it's validated
		// separately from the at-least-1 group below.
		const askHistoryMessages = Number(form.get('askHistoryMessages'));
		// Lifetime invite limits and PAYG credit rates live on the Packages page
		// (part of what a package buys / the priced product).
		for (const [label, value] of [
			['Cooldown', otpCooldownSeconds],
			['Daily cap', otpDailyCap],
			['Page size', pageSize],
			['Verified team members', requiredTeamManagers],
			['Sign-offs required', requiredSignoffs],
			['Max grounding characters', maxGroundingChars],
			['Guest AI Chat lifetime limit', guestAskLifetimeLimit],
			['Signed-in AI Chat daily limit', userAskDailyLimit],
			['Max question length', askMaxChars]
		] as const) {
			if (!Number.isInteger(value) || value < 1) return adminActionFailed(admin.domainUser.id, 400, { error: `${label} must be a whole number of at least 1.` });
		}
		if (!Number.isInteger(askHistoryMessages) || askHistoryMessages < 0) {
			return adminActionFailed(admin.domainUser.id, 400, { error: 'Conversation history must be a whole number of 0 or more.' });
		}
		if (!platformSystemPrompt) return adminActionFailed(admin.domainUser.id, 400, { error: 'The platform system prompt cannot be empty.' });
		if (!leaderSystemPrompt) return adminActionFailed(admin.domainUser.id, 400, { error: 'The leader system prompt cannot be empty.' });

		// Comma/whitespace-separated words, normalized to lowercase and deduped.
		// These block new leader slugs only. Existing slugs are untouched.
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
				askMaxChars,
				askHistoryMessages,
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
	},

	saveNewsFetchTime: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const newsFetchTime = String(form.get('newsFetchTime') ?? '');
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newsFetchTime)) return adminActionFailed(admin.domainUser.id, 400, { error: 'Crawl time must be a valid HH:MM.' });
		await db.update(platformSettings).set({ newsFetchTime, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
		return { saved: true };
	},

	// How many leaders' names ride in one Google News search query (see
	// newsBatchSize on newsIngest.ts's runIngest), tunable without a deploy
	// while the right value against Google's actual rate limits gets found.
	saveNewsBatchSize: async (event) => {
		const admin = await requireAdmin(event);
		const form = await event.request.formData();
		const newsBatchSize = Number(form.get('newsBatchSize'));
		if (!Number.isInteger(newsBatchSize) || newsBatchSize < 1) return adminActionFailed(admin.domainUser.id, 400, { error: 'Batch size must be a whole number of at least 1.' });
		await db.update(platformSettings).set({ newsBatchSize, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
		return { saved: true };
	},

	// Manual "Crawl now": the same ingestNews() the daily scheduler calls, but
	// with `recency: null`, dropping the scheduled run's 7-day window so each
	// query returns Google's full relevance-ranked 100. That's what backfills a
	// newly added leader's history, which a 7-day crawl can never reach.
	// ingestNews() itself guards against overlapping with a concurrent run (see
	// its ingestInFlight lock), so clicking this while the scheduled crawl is
	// mid-flight just no-ops instead of racing it.
	runNewsIngestNow: async (event) => {
		const admin = await requireAdmin(event);
		const result = await ingestNews({ recency: null });
		if (result.skipped) return adminActionFailed(admin.domainUser.id, 409, { error: 'A crawl is already running, try again shortly.' });
		return { crawled: true, ...result };
	}
};
