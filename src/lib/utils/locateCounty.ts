// Detects the visitor's county from browser coordinates, fully offline: a
// bundled simplified boundary file (geoBoundaries KEN ADM1, coords rounded to
// 4dp) is point-in-polygon tested in the browser. Coordinates never leave the
// device and are never stored — under the KDPA that matters next to a ballot.
// The boundary file is dynamically imported so its ~340KB only loads when the
// visitor actually taps "Use my location".
import { counties, geoSlug } from '$lib/data/geo';

type Ring = [number, number][];
type Feature = {
	properties: { name: string };
	geometry:
		| { type: 'Polygon'; coordinates: Ring[] }
		| { type: 'MultiPolygon'; coordinates: Ring[][] };
};

/** Boundary names that differ from the IEBC register after normalization. */
const ALIASES: Record<string, string> = {
	tharaka: 'tharaka-nithi'
};

function normalize(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Ray casting: is [lng, lat] inside the ring? */
function inRing(lng: number, lat: number, ring: Ring): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** First ring is the outer boundary; the rest are holes. */
function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
	if (!rings.length || !inRing(lng, lat, rings[0])) return false;
	for (let i = 1; i < rings.length; i++) if (inRing(lng, lat, rings[i])) return false;
	return true;
}

function contains(feature: Feature, lng: number, lat: number): boolean {
	const g = feature.geometry;
	if (g.type === 'Polygon') return inPolygon(lng, lat, g.coordinates);
	return g.coordinates.some((rings) => inPolygon(lng, lat, rings));
}

/** Squared degree-distance from the point to the feature's nearest vertex —
 * the tie-breaker for GPS points that fall just outside every polygon
 * (simplified boundaries + shoreline/border jitter). */
function nearestVertexDist2(feature: Feature, lng: number, lat: number): number {
	const g = feature.geometry;
	const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
	let best = Infinity;
	for (const rings of polys) {
		for (const [x, y] of rings[0]) {
			const d = (x - lng) ** 2 + (y - lat) ** 2;
			if (d < best) best = d;
		}
	}
	return best;
}

/** Maps a boundary feature name to a county slug from the IEBC register. */
function toCountySlug(name: string): string | null {
	const key = normalize(name);
	const aliased = ALIASES[key];
	for (const county of counties) {
		const slug = geoSlug(county.name);
		if (normalize(county.name) === key || slug === aliased) return slug;
	}
	return null;
}

/**
 * Resolves coordinates to a county slug, or null when the point is nowhere
 * near Kenya (more than ~0.25° from every boundary vertex).
 */
export async function detectCountySlug(lat: number, lng: number): Promise<string | null> {
	const { default: fc } = await import('$lib/data/kenya-counties.json');
	const features = fc.features as unknown as Feature[];

	const hit = features.find((f) => contains(f, lng, lat));
	if (hit) return toCountySlug(hit.properties.name);

	// Just outside every polygon: take the nearest county if it's plausibly close.
	let best: Feature | null = null;
	let bestDist = Infinity;
	for (const f of features) {
		const d = nearestVertexDist2(f, lng, lat);
		if (d < bestDist) {
			bestDist = d;
			best = f;
		}
	}
	if (best && bestDist < 0.25 ** 2) return toCountySlug(best.properties.name);
	return null;
}
