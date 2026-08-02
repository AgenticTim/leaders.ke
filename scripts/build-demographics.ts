// Builds src/lib/data/demographics.json from the KNBS 2019 census county
// age-sex tables (scripts/data/ken_admpop_adm1_2019.csv — the OCHA COD-PS
// dataset publishing KNBS figures, https://data.humdata.org/dataset/cod-ps-ken).
// County p-codes (KE001…KE047) match the IEBC county codes regions.json uses.
//
//   bun run scripts/build-demographics.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The published 5-year bands, in order. "100Plus" folds into '100+'.
const BANDS = [
	'00_04', '05_09', '10_14', '15_19', '20_24', '25_29', '30_34', '35_39', '40_44',
	'45_49', '50_54', '55_59', '60_64', '65_69', '70_74', '75_79', '80_84', '85_89',
	'90_94', '95_99', '100Plus'
] as const;

const csv = readFileSync(join(import.meta.dir, 'data/ken_admpop_adm1_2019.csv'), 'utf8');
const [headerLine, ...lines] = csv.trim().split('\n');
const header = headerLine.split(',');
const col = (name: string) => header.indexOf(name);

type BandCounts = Record<string, number>;
const counties: Record<string, { name: string; total: number; bands: BandCounts }> = {};
const national: BandCounts = {};
let nationalTotal = 0;

for (const line of lines) {
	const cells = line.split(',');
	const pcode = cells[col('ADM1_PCODE')];
	const name = cells[col('ADM1_NAME')];
	if (!pcode?.startsWith('KE')) continue;
	const code = pcode.slice(2); // KE001 -> 001, the IEBC county code
	const bands: BandCounts = {};
	let total = 0;
	for (const band of BANDS) {
		const n = Number(cells[col(`T_${band}`)] ?? 0) || 0;
		// '00_04' -> '0-4' (zero-padding stripped, matching demographics.ts BAND_ORDER).
		const key = band === '100Plus' ? '100+' : band.split('_').map((p) => String(Number(p))).join('-');
		bands[key] = n;
		total += n;
		national[key] = (national[key] ?? 0) + n;
	}
	counties[code] = { name, total, bands };
	nationalTotal += total;
}

if (Object.keys(counties).length !== 47) {
	throw new Error(`expected 47 counties, got ${Object.keys(counties).length}`);
}

const out = {
	source: 'KNBS 2019 Census (via OCHA COD-PS, data.humdata.org/dataset/cod-ps-ken)',
	censusYear: 2019,
	national: { total: nationalTotal, bands: national },
	counties
};
writeFileSync(join(import.meta.dir, '../src/lib/data/demographics.json'), JSON.stringify(out));
console.log(`47 counties, national total ${nationalTotal.toLocaleString()}`);
