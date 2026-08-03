// Projects the ward/constituency polygons already built by build-boundaries.ts
// (src/lib/data/boundaries/<county>.json, lng/lat rings) into flat SVG <path>
// "d" strings, so the Followers tab's voter heatmap can render an actual ward
// map instead of just a bar list. Equirectangular projection (x = lng, y =
// -lat, both scaled+flipped into a viewBox) is accurate enough at county
// scale — real projections don't matter for a UI-sized choropleth.
// Also projects the national county-outline map (kenya-counties.json, the
// same file locateCounty.ts uses) for seats with no single-county scope
// (President).
//
//   bun run scripts/build-ward-maps.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { counties, geoSlug } from '../src/lib/data/geo';

type Ring = [number, number][];
type Entry = { slug: string; polys: Ring[][] };
type BoundaryFile = { constituencies: Entry[]; wards: (Entry & { constituency: string })[] };

const VIEW = 512; // square viewBox; per-county aspect ratio preserved within it

function bbox(entries: { polys: Ring[][] }[]) {
	let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
	for (const e of entries) {
		for (const rings of e.polys) {
			for (const ring of rings) {
				for (const [lng, lat] of ring) {
					if (lng < minLng) minLng = lng;
					if (lng > maxLng) maxLng = lng;
					if (lat < minLat) minLat = lat;
					if (lat > maxLat) maxLat = lat;
				}
			}
		}
	}
	return { minLng, maxLng, minLat, maxLat };
}

/** Equirectangular fit into a square viewBox, uniform scale on both axes
 * (picks the tighter-fitting dimension) so shapes aren't stretched, and
 * corrects longitude for latitude (cos(lat)) so county shapes read true. */
function projector(box: ReturnType<typeof bbox>) {
	const midLatRad = ((box.minLat + box.maxLat) / 2) * (Math.PI / 180);
	const lngScale = Math.cos(midLatRad);
	const w = (box.maxLng - box.minLng) * lngScale;
	const h = box.maxLat - box.minLat;
	const scale = (VIEW * 0.94) / Math.max(w, h); // 3% padding each side
	const padX = (VIEW - w * scale) / 2;
	const padY = (VIEW - h * scale) / 2;
	return (lng: number, lat: number): [number, number] => [
		(lng - box.minLng) * lngScale * scale + padX,
		(box.maxLat - lat) * scale + padY // flip: SVG y grows downward
	];
}

function pathFor(polys: Ring[][], project: (lng: number, lat: number) => [number, number]): string {
	const parts: string[] = [];
	for (const rings of polys) {
		for (const ring of rings) {
			if (ring.length < 3) continue;
			const pts = ring.map(([lng, lat]) => project(lng, lat));
			parts.push(`M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`);
		}
	}
	return parts.join(' ');
}

// ---- per-county ward maps ----------------------------------------------

const boundariesDir = join(import.meta.dir, '../src/lib/data/boundaries');
const outDir = join(import.meta.dir, '../src/lib/data/wardMaps');
mkdirSync(outDir, { recursive: true });

let totalBytes = 0;
for (const file of readdirSync(boundariesDir)) {
	const slug = file.replace(/\.json$/, '');
	const data: BoundaryFile = JSON.parse(readFileSync(join(boundariesDir, file), 'utf8'));
	const project = projector(bbox(data.wards));
	const out = {
		viewBox: `0 0 ${VIEW} ${VIEW}`,
		wards: data.wards.map((w) => ({ slug: w.slug, constituency: w.constituency, d: pathFor(w.polys, project) }))
	};
	const json = JSON.stringify(out);
	writeFileSync(join(outDir, `${slug}.json`), json);
	totalBytes += json.length;
}
console.log(`ward maps: ${readdirSync(boundariesDir).length} counties, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total`);

// ---- national county-outline map ---------------------------------------

const countiesGeo = JSON.parse(readFileSync(join(import.meta.dir, '../src/lib/data/kenya-counties.json'), 'utf8'));
type Feature = { properties: { name: string }; geometry: { type: string; coordinates: unknown } };
const countyEntries = (countiesGeo.features as Feature[]).map((f) => ({
	name: f.properties.name,
	polys:
		f.geometry.type === 'Polygon'
			? [f.geometry.coordinates as Ring[]]
			: (f.geometry.coordinates as Ring[][])
}));
// Same boundary-file/register name drift locateCounty.ts already aliases.
const COUNTY_ALIASES: Record<string, string> = { tharaka: 'tharaka-nithi' };

const nationalProject = projector(bbox(countyEntries));
const nationalOut = {
	viewBox: `0 0 ${VIEW} ${VIEW}`,
	counties: countyEntries
		.map((c) => {
			const slug = geoSlug(c.name);
			const match = counties.find((k) => geoSlug(k.name) === (COUNTY_ALIASES[slug] ?? slug));
			return match ? { slug: geoSlug(match.name), d: pathFor(c.polys, nationalProject) } : null;
		})
		.filter((c): c is { slug: string; d: string } => !!c)
};
if (nationalOut.counties.length !== 47) throw new Error(`expected 47 counties, matched ${nationalOut.counties.length}`);
writeFileSync(join(outDir, 'national.json'), JSON.stringify(nationalOut));
console.log(`national map: ${nationalOut.counties.length}/47 counties matched`);
