// Extends the booth's "Use my location" beyond the county (16.5): after
// locateCounty.ts places the point in a county, that county's boundary pack
// (constituencies + wards with register slugs baked in, built by
// scripts/build-boundaries.ts) is point-in-polygon tested the same way — fully
// offline, in the browser; coordinates never leave the device and are never
// stored. Packs are lazy-loaded per county (50-300KB), so a visitor only ever
// downloads their own county's boundaries.
import { detectCountySlug, inPolygon, type Ring } from './locateCounty';

type Entry = { slug: string; polys: Ring[][] };
type Pack = { constituencies: Entry[]; wards: (Entry & { constituency: string })[] };

const packLoaders = import.meta.glob('/src/lib/data/boundaries/*.json', { import: 'default' }) as Record<
	string,
	() => Promise<Pack>
>;

function contains(entry: Entry, lng: number, lat: number): boolean {
	return entry.polys.some((rings) => inPolygon(lng, lat, rings));
}

/** Squared degree-distance from the point to the a→b segment. */
function segDist2(px: number, py: number, a: [number, number], b: [number, number]): number {
	let [x, y] = a;
	let dx = b[0] - x;
	let dy = b[1] - y;
	if (dx !== 0 || dy !== 0) {
		const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
		if (t > 1) [x, y] = b;
		else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}
	dx = px - x;
	dy = py - y;
	return dx * dx + dy * dy;
}

/** Squared degree-distance to the entry's nearest outer-ring EDGE — the snap
 * tie-breaker for points just outside every polygon. Edge (not vertex)
 * distance matters here: Douglas-Peucker leaves long straight edges whose
 * vertices sit far from a point that's only metres outside the line. */
function nearestDist2(entry: Entry, lng: number, lat: number): number {
	let best = Infinity;
	for (const rings of entry.polys) {
		const ring = rings[0];
		for (let i = 0; i < ring.length; i++) {
			const d = segDist2(lng, lat, ring[i], ring[(i + 1) % ring.length]);
			if (d < best) best = d;
		}
	}
	return best;
}

function locate<T extends Entry>(entries: T[], lng: number, lat: number, maxSnap: number): T | null {
	const hit = entries.find((e) => contains(e, lng, lat));
	if (hit) return hit;
	let best: T | null = null;
	let bestDist = Infinity;
	for (const e of entries) {
		const d = nearestDist2(e, lng, lat);
		if (d < bestDist) {
			bestDist = d;
			best = e;
		}
	}
	return best && bestDist < maxSnap ** 2 ? best : null;
}

export type DetectedSeat = { county: string | null; constituency: string | null; ward: string | null };

/**
 * Resolves coordinates to register slugs at all three levels. Constituency and
 * ward may be null independently: constituencies tile their county fully so a
 * miss there gets a generous snap (~5km, boundary jitter only), while ward
 * coverage has a few real gaps (13 register wards have no boundary in the
 * source data), so the ward snap stays tight (~500m) — better to leave the
 * ward step for a manual pick than to prefill a neighbour.
 */
export async function detectSeat(lat: number, lng: number): Promise<DetectedSeat> {
	const county = await detectCountySlug(lat, lng);
	if (!county) return { county: null, constituency: null, ward: null };
	const load = packLoaders[`/src/lib/data/boundaries/${county}.json`];
	if (!load) return { county, constituency: null, ward: null };
	const pack = await load();

	const constituency = locate(pack.constituencies, lng, lat, 0.05);
	// Ward search constrained to the matched constituency, so a point near an
	// internal border can't land in a ward the constituency pick contradicts.
	const wardScope = constituency ? pack.wards.filter((w) => w.constituency === constituency.slug) : pack.wards;
	const ward = locate(wardScope, lng, lat, 0.005);

	return { county, constituency: constituency?.slug ?? null, ward: ward?.slug ?? null };
}
