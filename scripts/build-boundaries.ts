// Builds the per-county constituency/ward boundary packs behind the booth's
// "Use my location" (src/lib/utils/locateSeat.ts) from the 2012 IEBC boundary
// GeoJSON preserved in github.com/mikelmaron/kenya-election-data (the same 290
// constituencies / 1,450 wards still in force for 2027).
//
//   bun run scripts/build-boundaries.ts <raw-dir>
//
// <raw-dir> must contain:
//   constituencies.geojson                    — all-constituency FeatureCollection
//   wards-raw/*.json                          — one FeatureCollection per ward
//     (the repo's data/httpapiiebcorkegeojsonward_<id>geojson files)
//
// Fetching the raw inputs (~130MB, not committed):
//   BASE=https://raw.githubusercontent.com/mikelmaron/kenya-election-data/master/data
//   curl -sL "$BASE/constituencies.geojson" -o constituencies.geojson
//   mkdir -p wards-raw
//   curl -s "https://api.github.com/repos/mikelmaron/kenya-election-data/git/trees/master?recursive=1" \
//     | grep -o '"data/httpapiiebcorkegeojsonward_[0-9]*geojson"' | tr -d '"' | sed 's|^data/||' \
//     | xargs -P 16 -I{} curl -sL "$BASE/{}" -o wards-raw/{}.json
//
// Counties and constituencies are matched against the IEBC register tree
// (geo.ts) by their IEBC codes (COUNTY_COD / CONST_CODE — the boundary files'
// NAME fields are unreliable: misspelled counties, renamed constituencies,
// wards filed under a neighbour). Wards carry no code in the register, so they
// are name-matched within the code-resolved constituency, with the alias map
// below covering spelling drift against the 2022 register. Output goes to
// src/lib/data/boundaries/<county-slug>.json with register slugs (geoSlug of
// the qualified seatName, what pickRegion and GeoSelect speak) baked in.
// Geometry is Douglas-Peucker simplified (~30m) and rounded to 4dp so each
// county pack stays lazy-loadable.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { counties, geoSlug } from '../src/lib/data/geo';

type Ring = [number, number][];
type RawFeature = {
	properties: Record<string, unknown>;
	geometry:
		| { type: 'Polygon'; coordinates: Ring[] }
		| { type: 'MultiPolygon'; coordinates: Ring[][] }
		| null;
};

// ---- name matching against the register ------------------------------------

function normalize(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Boundary-file ward names → register names (normalized), the drift left after
 * code-based county/constituency matching. Filled from the mismatch report. */
const WARD_ALIASES: Record<string, string> = {
	wargudud: 'wargadud', // Mandera South
	kisaukiteta: 'kitetakisau', // Mbooni
	porro: 'poro', // Samburu West
	mukogondoeast: 'mugogodoeast', // Laikipia North
	mukogondowest: 'mugogodowest', // Laikipia North
	buramwatate: 'bura', // Mwatate (disambiguated from Tana River's Bura in the source)
	warankara: 'waranqara', // Lafey
	yimbowest: 'westyimbo', // Bondo
	rumakaksingirieast: 'rumakaksingri', // Suba South
	sagala: 'sagalla', // Voi
	ademasajide: 'adamasajide', // Wajir West
	heilumanyatta: 'heillumanyatta', // Moyale
	kaikorkaaleng: 'kaalengkaikor', // Turkana North
	bukhayonorthwalatsi: 'bukhayonorthwaltsi' // Nambale
};

/** Unusable COUNTY_A_1 values ("`", a bare code, a name that collides with a
 * register neighbour) → register ward name, keyed by source filename. */
const FILE_WARD_OVERRIDES: Record<string, string> = {
	'httpapiiebcorkegeojsonward_1084geojson.json': 'Lwandanyi', // COUNTY_A_1 is "`" (Sirisia)
	'httpapiiebcorkegeojsonward_245geojson.json': 'Ngare Mara', // COUNTY_A_1 is "673" (Isiolo North)
	'httpapiiebcorkegeojsonward_97geojson.json': 'Hirimani', // named "BURA" in the source; the register's Bura constituency has no Bura ward
	// "MUGUMO-INI": Langata's register ward is Mugumu-Ini, but Gatanga
	// (Murang'a) has a real Mugumo-Ini — spelled identically in the source, so
	// the Langata one is corrected per-file, never via a global alias.
	'httpapiiebcorkegeojsonward_1383geojson.json': 'Mugumu-Ini'
};

// Code lookups: IEBC codes are stable across 2013/2017/2022 and shared by the
// boundary files and the register.
const countyByCode = new Map(counties.map((c) => [Number(c.code), c]));
const constituencyByCode = new Map(
	counties.flatMap((county) => county.constituencies.map((c) => [Number(c.code), { county, constituency: c }] as const))
);

function wardByName(constituency: { wards: { name: string; seatName: string }[] }, raw: string) {
	const key = WARD_ALIASES[normalize(raw)] ?? normalize(raw);
	return constituency.wards.find((w) => normalize(w.name) === key) ?? null;
}

// ---- geometry simplification ------------------------------------------------

/** Perpendicular distance (degrees) from p to the a→b segment. */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
	let [x, y] = a;
	let dx = b[0] - x;
	let dy = b[1] - y;
	if (dx !== 0 || dy !== 0) {
		const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
		if (t > 1) [x, y] = b;
		else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}
	dx = p[0] - x;
	dy = p[1] - y;
	return Math.sqrt(dx * dx + dy * dy);
}

/** Iterative Douglas-Peucker. ~3e-4° ≈ 30m — coarser than GPS error, fine for
 * "which ward am I standing in". */
const EPSILON = 3e-4;
function simplify(ring: Ring): Ring {
	if (ring.length <= 4) return ring;
	const keep = new Uint8Array(ring.length);
	keep[0] = keep[ring.length - 1] = 1;
	const stack: [number, number][] = [[0, ring.length - 1]];
	while (stack.length) {
		const [first, last] = stack.pop()!;
		let maxDist = 0;
		let index = 0;
		for (let i = first + 1; i < last; i++) {
			const d = segDist(ring[i], ring[first], ring[last]);
			if (d > maxDist) {
				maxDist = d;
				index = i;
			}
		}
		if (maxDist > EPSILON) {
			keep[index] = 1;
			stack.push([first, index], [index, last]);
		}
	}
	return ring.filter((_, i) => keep[i]);
}

function round(ring: Ring): Ring {
	const out: Ring = [];
	for (const [lng, lat] of ring) {
		const x = Math.round(lng * 1e4) / 1e4;
		const y = Math.round(lat * 1e4) / 1e4;
		const prev = out[out.length - 1];
		if (!prev || prev[0] !== x || prev[1] !== y) out.push([x, y]);
	}
	return out;
}

/** Feature geometry → array of polygons (each: outer ring + holes), simplified. */
function toPolys(feature: RawFeature): Ring[][] {
	const g = feature.geometry;
	if (!g) return [];
	const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
	return polys
		.map((rings) => rings.map((r) => round(simplify(r))).filter((r) => r.length >= 4))
		.filter((rings) => rings.length > 0);
}

// ---- build ------------------------------------------------------------------

const rawDir = process.argv[2];
if (!rawDir) {
	console.error('Usage: bun run scripts/build-boundaries.ts <raw-dir>');
	process.exit(1);
}

type Entry = { slug: string; polys: Ring[][] };
type WardEntry = Entry & { constituency: string };
const packs = new Map<string, { constituencies: Map<string, Entry>; wards: Map<string, WardEntry> }>();
const misses: string[] = [];

function packFor(countySlug: string) {
	let pack = packs.get(countySlug);
	if (!pack) {
		pack = { constituencies: new Map(), wards: new Map() };
		packs.set(countySlug, pack);
	}
	return pack;
}

// Constituencies: one national FeatureCollection, matched purely by CONST_CODE.
const constituencyFc = JSON.parse(readFileSync(join(rawDir, 'constituencies.geojson'), 'utf8'));
for (const feature of constituencyFc.features as RawFeature[]) {
	const code = Number(feature.properties.CONST_CODE ?? 0);
	// A few features are fully anonymous slivers (every property null) — skip.
	if (!code && !feature.properties.CONSTITUEN) continue;
	const hit = constituencyByCode.get(code);
	if (!hit) {
		misses.push(`constituency code ${code} ("${feature.properties.CONSTITUEN}") not in register (constituencies.geojson)`);
		continue;
	}
	const slug = geoSlug(hit.constituency.seatName);
	const pack = packFor(geoSlug(hit.county.name));
	const entry = pack.constituencies.get(slug) ?? { slug, polys: [] };
	entry.polys.push(...toPolys(feature));
	pack.constituencies.set(slug, entry);
}

// Wards: one FeatureCollection per file. County/constituency come from codes;
// the ward itself is name-matched inside that constituency (county-wide as a
// fallback, since a few features carry a neighbour's CONST_CODE).
const wardDir = join(rawDir, 'wards-raw');
for (const file of readdirSync(wardDir)) {
	const fc = JSON.parse(readFileSync(join(wardDir, file), 'utf8'));
	for (const feature of (fc.features ?? []) as RawFeature[]) {
		const countyCode = Number(feature.properties.COUNTY_COD ?? 0);
		const constCode = Number(feature.properties.CONST_CODE ?? 0);
		const wardRaw = FILE_WARD_OVERRIDES[file] ?? String(feature.properties.COUNTY_A_1 ?? '');
		// A handful of features have COUNTY_COD zeroed out (and some of those a
		// wrong CONST_CODE too) — their CONSTITUEN name is still good, so fall back
		// to a national constituency-name lookup to recover the county.
		let county = countyByCode.get(countyCode) ?? null;
		if (!county) {
			const constRaw = normalize(String(feature.properties.CONSTITUEN ?? ''));
			county = counties.find((c) => c.constituencies.some((k) => normalize(k.name) === constRaw)) ?? null;
		}
		if (!county) {
			misses.push(`county code ${countyCode} not in register (${file})`);
			continue;
		}
		const coded = constituencyByCode.get(constCode);
		const scope = [
			...(coded && coded.county === county ? [coded.constituency] : []),
			...county.constituencies.filter((c) => c !== coded?.constituency)
		];
		let hit: { ward: { seatName: string }; constituency: (typeof county.constituencies)[number] } | null = null;
		for (const c of scope) {
			const ward = wardRaw ? wardByName(c, wardRaw) : null;
			if (ward) {
				hit = { ward, constituency: c };
				break;
			}
		}
		if (!hit) {
			misses.push(`ward not in register: "${wardRaw}" (county ${county.name}, constituency "${feature.properties.CONSTITUEN}", ${file})`);
			continue;
		}
		const slug = geoSlug(hit.ward.seatName);
		const pack = packFor(geoSlug(county.name));
		const entry = pack.wards.get(slug) ?? { slug, constituency: geoSlug(hit.constituency.seatName), polys: [] };
		entry.polys.push(...toPolys(feature));
		pack.wards.set(slug, entry);
	}
}

// Write one pack per county + coverage report.
const outDir = join(import.meta.dir, '../src/lib/data/boundaries');
mkdirSync(outDir, { recursive: true });
let totalBytes = 0;
let constTotal = 0;
let wardTotal = 0;
for (const county of counties) {
	const slug = geoSlug(county.name);
	const pack = packs.get(slug);
	if (!pack) {
		misses.push(`no boundaries at all for county ${county.name}`);
		continue;
	}
	const json = JSON.stringify({
		constituencies: [...pack.constituencies.values()],
		wards: [...pack.wards.values()]
	});
	writeFileSync(join(outDir, `${slug}.json`), json);
	totalBytes += json.length;
	constTotal += pack.constituencies.size;
	wardTotal += pack.wards.size;
	const missingConst = county.constituencies.filter((c) => !pack.constituencies.has(geoSlug(c.seatName)));
	const missingWards = county.constituencies.flatMap((c) => c.wards.filter((w) => !pack.wards.has(geoSlug(w.seatName))).map((w) => `${w.name} (${c.name})`));
	if (missingConst.length) misses.push(`register constituencies with no boundary in ${county.name}: ${missingConst.map((c) => c.name).join(', ')}`);
	if (missingWards.length) misses.push(`register wards with no boundary in ${county.name}: ${missingWards.join(', ')}`);
}

console.log(`packs: ${packs.size} counties, ${constTotal} constituencies, ${wardTotal} wards, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total`);
if (misses.length) {
	console.log(`\n${misses.length} mismatches:`);
	for (const m of misses) console.log(`  - ${m}`);
	process.exitCode = 1;
}
