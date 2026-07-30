import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { platformSettings } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/dashboard';
import { getPlatformSettings } from '$lib/server/settings';
import {
	BILLING_CYCLES,
	listCurrentPricing,
	listPackages,
	PACKAGE_FEATURE_KEYS,
	PACKAGE_PERK_KEYS,
	setPackageFeature,
	setPackagePerk,
	setRate,
	SUBSCRIPTION_TIERS,
	type PackageFeatureKey,
	type PackagePerkKey
} from '$lib/server/packages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	const settings = await getPlatformSettings();
	return {
		pricing: await listCurrentPricing(),
		packages: await listPackages(),
		// Lifetime invite caps are part of what each package buys, so they're
		// managed here on the package matrix, not under Settings.
		inviteLimits: settings.inviteLimits,
		// PAYG credit rates (the /pricing Credits table) — priced product, so they
		// live here at the top of Packages rather than under Settings.
		creditRates: {
			aiChat: settings.aiChatCostCredits,
			sms: settings.smsCostCredits,
			whatsapp: settings.whatsappCostCredits
		}
	};
};

export const actions: Actions = {
	setRate: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const tier = String(form.get('tier') ?? '');
		const billingCycle = String(form.get('billingCycle') ?? '');
		const amount = Number(form.get('amount') ?? 0);

		if (
			!SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number]) ||
			!BILLING_CYCLES.includes(billingCycle as (typeof BILLING_CYCLES)[number])
		) {
			return fail(400, { error: 'Invalid tier or billing cycle.' });
		}
		if (!Number.isFinite(amount) || amount <= 0) return fail(400, { error: 'Enter a valid amount in KES.' });

		await setRate(tier as (typeof SUBSCRIPTION_TIERS)[number], billingCycle as (typeof BILLING_CYCLES)[number], amount);
		return { updated: true };
	},

	// One cap on one package; an emptied input means unlimited (null).
	setFeature: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const tier = String(form.get('tier') ?? '');
		const key = String(form.get('key') ?? '');
		const raw = String(form.get('value') ?? '').trim();

		if (!SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number]) || !PACKAGE_FEATURE_KEYS.includes(key as PackageFeatureKey)) {
			return fail(400, { error: 'Invalid tier or feature.' });
		}
		const value = raw === '' ? null : Number(raw);
		if (value !== null && (!Number.isInteger(value) || value < 0)) {
			return fail(400, { error: 'Enter a whole number, or clear the field for unlimited.' });
		}

		const result = await setPackageFeature(tier as (typeof SUBSCRIPTION_TIERS)[number], key as PackageFeatureKey, value);
		if (!result.ok) return fail(400, { error: result.error });
		return { updated: true };
	},

	// One perk toggle. Checkboxes only submit when CHECKED, so a plain
	// form.get('value') can't distinguish "off" from "not submitted" — the
	// checkbox posts its own onchange (always present) instead, carrying the
	// new state explicitly.
	setPerk: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const tier = String(form.get('tier') ?? '');
		const key = String(form.get('key') ?? '');
		const value = form.get('value') === 'true';

		if (!SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number]) || !PACKAGE_PERK_KEYS.includes(key as PackagePerkKey)) {
			return fail(400, { error: 'Invalid tier or perk.' });
		}

		const result = await setPackagePerk(tier as (typeof SUBSCRIPTION_TIERS)[number], key as PackagePerkKey, value);
		if (!result.ok) return fail(400, { error: result.error });
		return { updated: true };
	},

	saveInviteLimits: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const kickstart = Number(form.get('kickstart'));
		const mobilize = Number(form.get('mobilize'));
		const dominate = Number(form.get('dominate'));

		for (const [label, value] of [
			['Kickstart limit', kickstart],
			['Mobilize limit', mobilize],
			['Dominate limit', dominate]
		] as const) {
			if (!Number.isInteger(value) || value < 1) return fail(400, { error: `${label} must be a whole number of at least 1.` });
		}

		await db
			.update(platformSettings)
			.set({ inviteLimits: { kickstart, mobilize, dominate }, updatedAt: new Date() })
			.where(eq(platformSettings.id, 1));
		return { updated: true };
	},

	// PAYG credit rates shown on /pricing and charged by broadcast.ts / the AI ask.
	saveCreditRates: async (event) => {
		await requireAdmin(event);
		const form = await event.request.formData();
		const aiChatCostCredits = Number(form.get('aiChatCostCredits'));
		const smsCostCredits = Number(form.get('smsCostCredits'));
		const whatsappCostCredits = Number(form.get('whatsappCostCredits'));

		for (const [label, value] of [
			['AI chat credits', aiChatCostCredits],
			['SMS credits', smsCostCredits],
			['WhatsApp credits', whatsappCostCredits]
		] as const) {
			if (!Number.isInteger(value) || value < 1) return fail(400, { error: `${label} must be a whole number of at least 1.` });
		}

		await db
			.update(platformSettings)
			.set({ aiChatCostCredits, smsCostCredits, whatsappCostCredits, updatedAt: new Date() })
			.where(eq(platformSettings.id, 1));
		return { updated: true };
	}
};
