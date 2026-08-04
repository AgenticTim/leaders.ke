// Voter-demographics analysis over the KNBS 2019 census county age structure
// (demographics.json, built by scripts/build-demographics.ts) and the IEBC 2022
// registered-voter counts already in regions.json. 2027 figures are cohort
// projections: whoever was aged N at the census (Aug 2019) is N+8 by election
// day (Aug 2027); mortality and migration ignored, so every consumer must
// label them estimates. Ward/constituency age splits are county shares applied
// to the seat's registered voters (nobody publishes sub-county age data).
import raw from './demographics.json';

export type BandCounts = Record<string, number>;
export type CountyDemographics = { name: string; total: number; bands: BandCounts };

export const DEMOGRAPHICS_SOURCE = raw.source as string;
export const CENSUS_YEAR = raw.censusYear as number;
export const NATIONAL: { total: number; bands: BandCounts } = raw.national;
export const COUNTIES: Record<string, CountyDemographics> = raw.counties;

/** Census bands in display order. */
export const BAND_ORDER = [
	'0-4', '5-9', '10-14', '15-19', '20-24', '25-29', '30-34', '35-39', '40-44',
	'45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79', '80-84', '85-89',
	'90-94', '95-99', '100+'
];

const band = (bands: BandCounts, key: string) => bands[key] ?? 0;

/** Voting-age population come Aug 2027: 18+ then = aged 10+ at the census.
 * (The 10-14 band's youngest turn 18 during 2027; the August cutoff makes the
 * full band a fair approximation.) */
export function votingAge2027(bands: BandCounts): number {
	return BAND_ORDER.filter((b) => !['0-4', '5-9'].includes(b)).reduce((sum, b) => sum + band(bands, b), 0);
}

/** Gen-z (born 1997-2012) old enough to vote in Aug 2027: born 1997 to Aug
 * 2009, i.e. aged ~10-22 at the census. 10-14 and 15-19 count whole; 20-24
 * contributes its 1997-1999 cohorts (~3/5 of the band). */
export function genZEligible2027(bands: BandCounts): number {
	return Math.round(band(bands, '10-14') + band(bands, '15-19') + 0.6 * band(bands, '20-24'));
}

/** Millennials (born 1981-1996): aged 23-38 at the census: 2/5 of 20-24,
 * then 25-29, 30-34, and 4/5 of 35-39. */
export function millennials2027(bands: BandCounts): number {
	return Math.round(
		0.4 * band(bands, '20-24') + band(bands, '25-29') + band(bands, '30-34') + 0.8 * band(bands, '35-39')
	);
}

/** Youth as public discourse uses it (18-34 in 2027): aged 10-26 at the census
 * (10-14, 15-19, 20-24 whole, then 2/5 of 25-29). */
export function youth2027(bands: BandCounts): number {
	return Math.round(
		band(bands, '10-14') + band(bands, '15-19') + band(bands, '20-24') + 0.4 * band(bands, '25-29')
	);
}

/** Gen-z's share of the 2027 voting-age population for this scope. */
export function genZShare2027(bands: BandCounts): number {
	const va = votingAge2027(bands);
	return va > 0 ? genZEligible2027(bands) / va : 0;
}

/** Applies a county-level share to a seat's registered voters, the ward/
 * constituency estimator ("assumes the seat's registration mirrors the
 * county's age structure"). */
export function estimateFromRegistered(registeredVoters: number, share: number): number {
	return Math.round(registeredVoters * share);
}

/** 2022 General Election presidential turnout: 14,213,137 votes cast of
 * 22,120,458 registered (IEBC). The planning assumption below rounds it up a
 * touch for 2027 benchmarks. */
export const TURNOUT_2022 = 0.6425;
export const ASSUMED_TURNOUT_2027 = 0.65;

/** Rough "winning tally" benchmark for a seat: half of expected turnout plus
 * one. A two-horse-race simplification, labeled as such wherever shown. */
export function votesToWin(registeredVoters: number): number {
	return Math.round(registeredVoters * ASSUMED_TURNOUT_2027 * 0.5) + 1;
}
