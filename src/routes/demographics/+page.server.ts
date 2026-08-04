// /demographics: voter data analysis: the KNBS 2019 census age structure and
// IEBC 2022 register (regions.json) combined into 2027 cohort projections,
// nationally and per county, with gen-z estimates down to every constituency
// and ward (county age shares applied to each seat's registered voters).
import { counties, geoSlug } from '$lib/data/geo';
import {
	BAND_ORDER,
	COUNTIES,
	NATIONAL,
	genZEligible2027,
	genZShare2027,
	millennials2027,
	votingAge2027,
	youth2027,
	estimateFromRegistered,
	CENSUS_YEAR,
	DEMOGRAPHICS_SOURCE
} from '$lib/data/demographics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const countySlug = url.searchParams.get('county') ?? '';
	const county = counties.find((c) => geoSlug(c.name) === countySlug) ?? null;
	const scopeBands = county ? COUNTIES[county.code]?.bands : NATIONAL.bands;
	const bands = scopeBands ?? NATIONAL.bands;

	const registered = county
		? county.voters
		: counties.reduce((sum, c) => sum + c.voters, 0);
	const population = county ? (COUNTIES[county.code]?.total ?? 0) : NATIONAL.total;
	const share = genZShare2027(bands);

	return {
		censusYear: CENSUS_YEAR,
		source: DEMOGRAPHICS_SOURCE,
		countyOptions: counties.map((c) => ({ slug: geoSlug(c.name), name: c.name })),
		scope: county ? county.name : 'Kenya',
		countySlug,
		stats: {
			population,
			registered,
			votingAge2027: votingAge2027(bands),
			genZEligible2027: genZEligible2027(bands),
			genZShare2027: share,
			genZRegisteredEst: estimateFromRegistered(registered, share),
			youth2027: youth2027(bands),
			millennials2027: millennials2027(bands)
		},
		// Age distribution for the bar list, largest band first is NOT wanted;
		// keep natural age order so the pyramid shape reads.
		ageBands: BAND_ORDER.map((b) => ({
			band: b,
			count: bands[b] ?? 0,
			share: population > 0 ? (bands[b] ?? 0) / population : 0
		})),
		// Seat-level gen-z estimates: the selected county's constituencies and
		// wards (or per-county rollup nationally), registered voters × county share.
		// `slug` is geoSlug(seatName), the key build-ward-maps.ts's ward shapes
		// use, so WardMap.svelte can match rows to paths directly.
		seats: county
			? county.constituencies.map((constituency) => ({
					name: constituency.name,
					voters: constituency.voters,
					genZEst: estimateFromRegistered(constituency.voters, share),
					wards: constituency.wards.map((w) => ({
						name: w.name,
						slug: geoSlug(w.seatName),
						voters: w.voters,
						genZEst: estimateFromRegistered(w.voters, share)
					}))
				}))
			: null,
		// The county's map key (for the ward choropleth), same slug the seat
		// hub's boundaries/wardMaps files are named by.
		wardMapKey: county ? geoSlug(county.name) : 'national',
		countyRollup: county
			? null
			: counties
					.map((c) => {
						const cBands = COUNTIES[c.code]?.bands;
						const cShare = cBands ? genZShare2027(cBands) : 0;
						return {
							slug: geoSlug(c.name),
							name: c.name,
							voters: c.voters,
							genZShare: cShare,
							genZEst: estimateFromRegistered(c.voters, cShare)
						};
					})
					.sort((a, b) => b.genZEst - a.genZEst),
		// The choropleth's own metric: estimated 2027 voting-age POPULATION
		// magnitude (not gen-z, not a rate), how many people, not what share.
		// National: votingAge2027 read straight off each county's own census
		// bands, a real figure, no estimation. County/ward: no sub-county
		// census exists, so the county's voting-age share of its OWN
		// population is applied to each ward's registered voters, same
		// proportional-estimate method the gen-z figures above use.
		votingAgeMap: county
			? {
					scope: 'ward' as const,
					rows: county.constituencies.flatMap((c) =>
						c.wards.map((w) => {
							const vaShareOfPopulation = population > 0 ? votingAge2027(bands) / population : 0;
							return { slug: geoSlug(w.seatName), value: estimateFromRegistered(w.voters, vaShareOfPopulation), total: w.voters };
						})
					)
				}
			: {
					scope: 'national' as const,
					rows: counties.map((c) => {
						const cBands = COUNTIES[c.code]?.bands;
						return { slug: geoSlug(c.name), value: cBands ? votingAge2027(cBands) : 0, total: COUNTIES[c.code]?.total ?? 0 };
					})
				}
	};
};
