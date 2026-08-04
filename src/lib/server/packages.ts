// Admin "Packages" tab: the subscription rate card (pricing table) and each
// package's caps (packages table). Rates are versioned, not mutated in place, so
// changing one supersedes the current row (sets its activeTo) and inserts a fresh
// one, history stays intact for audit. Caps are edited in place.
//
// pricing-v2: one flat rate per tier for every office. No seat band involved.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { packages, pricing, type PackageFeatures } from '$lib/server/db/schema';
import packageData from '$lib/data/packages.json';

export type PricingRow = {
	id: number;
	tier: string;
	billingCycle: string;
	amount: number;
	activeFrom: string;
};

export const SUBSCRIPTION_TIERS = ['kickstart', 'mobilize', 'dominate'] as const;
export const BILLING_CYCLES = ['monthly', 'annual'] as const;

type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];
type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Tier order for feature gates: a feature sold as "Mobilize and up" checks
 * tierAtLeast(tier, 'mobilize') instead of enumerating tiers at every gate. */
export function tierAtLeast(tier: SubscriptionTier, min: SubscriptionTier): boolean {
	return SUBSCRIPTION_TIERS.indexOf(tier) >= SUBSCRIPTION_TIERS.indexOf(min);
}

/** Every currently-active rate (activeTo is null), one per (tier, cycle). */
export async function listCurrentPricing(): Promise<PricingRow[]> {
	const rows = await db.select().from(pricing).where(isNull(pricing.activeTo));
	return rows.map((r) => ({
		id: r.id,
		tier: r.tier,
		billingCycle: r.billingCycle,
		amount: r.amount,
		activeFrom: r.activeFrom.toISOString()
	}));
}

export async function setRate(tier: SubscriptionTier, billingCycle: BillingCycle, amount: number) {
	const now = new Date();
	await db
		.update(pricing)
		.set({ activeTo: now })
		.where(and(eq(pricing.tier, tier), eq(pricing.billingCycle, billingCycle), isNull(pricing.activeTo)));
	await db.insert(pricing).values({ tier, billingCycle, amount, activeFrom: now });
}

export const PACKAGE_FEATURE_KEYS = ['managers', 'ambassadors', 'subscriptions', 'creditsPerMonth', 'knowledgeMb'] as const;
export type PackageFeatureKey = (typeof PACKAGE_FEATURE_KEYS)[number];

// On/off perks: the /pricing comparison table's ✓/- rows, plus whatever a
// tier-gated feature checks in code (e.g. the News tab's PR AI Agent). The key
// list is literal here (drives iteration order + TS narrowing); the LABEL text
// itself lives in packages.json's perkLabels. The single source /pricing,
// /dashboard/admin/packages, and this module all read, so wording only ever
// changes in one place.
export const PACKAGE_PERK_KEYS = ['analytics', 'prAiAgent', 'voterHeatmap', 'sentimentSuite', 'newsSourceControl'] as const;
export type PackagePerkKey = (typeof PACKAGE_PERK_KEYS)[number];
export const PERK_LABELS: Record<PackagePerkKey, string> = packageData.perkLabels;

export type PackageRow = { tier: string; features: PackageFeatures };

/** Every package's caps, one row per tier, seeded from packages.json. */
export async function listPackages(): Promise<PackageRow[]> {
	const rows = await db.select().from(packages);
	return rows.map((r) => ({ tier: r.tier, features: r.features }));
}

/** One tier's caps, for runtime enforcement (e.g. the Knowledge tab's upload
 * cap), where only one tier's features are needed, not the whole matrix. */
export async function getPackageFeatures(tier: SubscriptionTier): Promise<PackageFeatures | null> {
	const [row] = await db.select({ features: packages.features }).from(packages).where(eq(packages.tier, tier));
	return row?.features ?? null;
}

/** Updates one cap on one package; null = unlimited. */
export async function setPackageFeature(tier: SubscriptionTier, key: PackageFeatureKey, value: number | null) {
	const [row] = await db.select({ id: packages.id, features: packages.features }).from(packages).where(eq(packages.tier, tier));
	if (!row) return { ok: false as const, error: 'Package not found, run the packages seed first.' };

	await db
		.update(packages)
		.set({ features: { ...row.features, [key]: value }, updatedAt: new Date() })
		.where(eq(packages.id, row.id));
	return { ok: true as const };
}

/** Flips one on/off perk on one package. */
export async function setPackagePerk(tier: SubscriptionTier, key: PackagePerkKey, value: boolean) {
	const [row] = await db.select({ id: packages.id, features: packages.features }).from(packages).where(eq(packages.tier, tier));
	if (!row) return { ok: false as const, error: 'Package not found, run the packages seed first.' };

	await db
		.update(packages)
		.set({ features: { ...row.features, [key]: value }, updatedAt: new Date() })
		.where(eq(packages.id, row.id));
	return { ok: true as const };
}
