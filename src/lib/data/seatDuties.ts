// Job description per elective seat, sourced from the Constitution of Kenya
// (2010) and, where the Constitution is thin on member-level duties, the
// County Governments Act No. 17 of 2012, both as published by Kenya Law
// (National Council for Law Reporting). Wording is plain-language but faithful
// to the cited article/section; every group cites its source.
//   Constitution: https://new.kenyalaw.org/akn/ke/act/2010/constitution/eng@2010-09-03
//   County Governments Act: https://new.kenyalaw.org/akn/ke/act/2012/17/eng@2013-08-18
// Deep links use the documents' own Akoma Ntoso anchors (the TOC ids on
// kenyalaw.org), verified against the published HTML.
const CONSTITUTION_URL = 'https://new.kenyalaw.org/akn/ke/act/2010/constitution/eng@2010-09-03';
const CGA_URL = 'https://new.kenyalaw.org/akn/ke/act/2012/17/eng@2013-08-18';
const cok = (anchor: string) => `${CONSTITUTION_URL}#${anchor}`;
const cga = (anchor: string) => `${CGA_URL}#${anchor}`;

export type DutyGroup = {
	heading: string;
	sourceLabel: string; // e.g. "Constitution of Kenya, Art. 132"
	sourceUrl: string;
	items: string[];
};

export type SeatDuties = {
	summary: string; // one sentence: what this job IS
	groups: DutyGroup[];
};

// Keyed by the same position titles seat.ts and srcPay.ts use.
export const SEAT_DUTIES_BY_TITLE: Record<string, SeatDuties> = {
	President: {
		summary:
			'Head of State and Government, Commander-in-Chief of the Kenya Defence Forces, and the symbol of national unity.',
		groups: [
			{
				heading: 'Authority',
				sourceLabel: 'Constitution of Kenya, Art. 131',
				sourceUrl: cok('chp_Nine__part_2__sec_131'),
				items: [
					'Exercises the executive authority of the Republic, with the assistance of the Deputy President and Cabinet Secretaries',
					'Respects, upholds and safeguards the Constitution',
					'Safeguards the sovereignty of the Republic',
					'Promotes and enhances the unity of the nation and respect for the diversity of the people',
					'Ensures the protection of human rights, fundamental freedoms and the rule of law'
				]
			},
			{
				heading: 'Functions',
				sourceLabel: 'Constitution of Kenya, Art. 132',
				sourceUrl: cok('chp_Nine__part_2__sec_132'),
				items: [
					'Addresses the opening of each newly elected Parliament and reports annually on the state of the nation',
					'Nominates and, with National Assembly approval, appoints Cabinet Secretaries, the Attorney-General, Principal Secretaries, ambassadors and high commissioners',
					'Chairs Cabinet meetings and directs and co-ordinates the functions of ministries and government departments',
					'Receives foreign diplomatic and consular representatives',
					'Confers honours in the name of the people and the Republic',
					'Declares a state of emergency, or (with National Assembly approval) war'
				]
			}
		]
	},
	Governor: {
		summary: "The county's chief executive, heading the county government together with the deputy governor.",
		groups: [
			{
				heading: 'Executive authority',
				sourceLabel: 'Constitution of Kenya, Art. 179 & 183',
				sourceUrl: cok('chp_Eleven__part_2__sec_179'),
				items: [
					'Heads the county executive committee, the executive arm of the county government',
					'Through the committee, implements county legislation and relevant national legislation within the county',
					'Manages and co-ordinates the functions of the county administration and its departments'
				]
			},
			{
				heading: 'Duties of the office',
				sourceLabel: 'County Governments Act, s.30',
				sourceUrl: cga('part_V__sec_30'),
				items: [
					'Diligently executes the functions and exercises the authority provided for in the Constitution and legislation',
					'Delivers an annual state-of-the-county address',
					'Appoints, with county assembly approval, the county executive committee members and county secretary',
					'Submits the county plans and policies to the county assembly for approval',
					'Considers, approves and assents to bills passed by the county assembly',
					'Promotes democracy, good governance, unity and cohesion within the county',
					'Promotes peace and order, and the competitiveness of the county',
					'Is accountable for the management and use of the county resources'
				]
			}
		]
	},
	Senator: {
		summary: "The county's voice in the Senate, which represents and protects the counties and their governments.",
		groups: [
			{
				heading: 'Role of the Senate',
				sourceLabel: 'Constitution of Kenya, Art. 96',
				sourceUrl: cok('chp_Eight__part_1__sec_96'),
				items: [
					'Represents the county and serves to protect the interests of counties and their governments',
					'Participates in law-making by considering, debating and approving Bills concerning counties',
					'Determines the allocation of national revenue among counties (Art. 217)',
					'Exercises oversight over national revenue allocated to the county governments',
					'Considers and determines resolutions to remove the President or Deputy President from office, and hears governor impeachments'
				]
			}
		]
	},
	'Woman Rep': {
		summary:
			'The woman member of the National Assembly elected by the voters of the whole county, a full MP with a countywide constituency.',
		groups: [
			{
				heading: 'The seat',
				sourceLabel: 'Constitution of Kenya, Art. 97(1)(b)',
				sourceUrl: cok('chp_Eight__part_2__sec_97'),
				items: [
					'One woman elected to the National Assembly by the registered voters of the entire county',
					'Created to advance gender balance in Parliament toward the not-more-than-two-thirds principle (Art. 27(8), 81(b))'
				]
			},
			{
				heading: 'Role in the National Assembly',
				sourceLabel: 'Constitution of Kenya, Art. 95',
				sourceUrl: cok('chp_Eight__part_1__sec_95'),
				items: [
					'Represents the people of the county and their special interests in the National Assembly',
					'Deliberates on and resolves issues of concern to the people',
					'Enacts national legislation',
					'Determines the allocation of national revenue between the levels of government and appropriates funds for expenditure',
					'Exercises oversight over national revenue, its expenditure, and State organs'
				]
			}
		]
	},
	MP: {
		summary: "The constituency's representative in the National Assembly.",
		groups: [
			{
				heading: 'Role of the National Assembly',
				sourceLabel: 'Constitution of Kenya, Art. 95',
				sourceUrl: cok('chp_Eight__part_1__sec_95'),
				items: [
					'Represents the people of the constituency and their special interests',
					'Deliberates on and resolves issues of concern to the people',
					'Enacts national legislation',
					'Determines the allocation of national revenue between the levels of government and appropriates funds for expenditure',
					'Exercises oversight over national revenue and its expenditure',
					'Reviews the conduct in office of the President, Deputy President and other State officers, and can initiate their removal',
					'Approves declarations of war and extensions of states of emergency'
				]
			}
		]
	},
	MCA: {
		summary: "The ward's representative in the county assembly, the law-making arm of the county government.",
		groups: [
			{
				heading: 'Role of the county assembly',
				sourceLabel: 'Constitution of Kenya, Art. 185',
				sourceUrl: cok('chp_Eleven__part_2__sec_185'),
				items: [
					'Makes any laws necessary for the effective performance of the county government\'s functions',
					'Exercises oversight over the county executive committee and other county executive organs',
					'Approves the county\'s plans and policies for the management of its resources and infrastructure'
				]
			},
			{
				heading: 'Duties of the member',
				sourceLabel: 'County Governments Act, s.9',
				sourceUrl: cga('part_III__sec_9'),
				items: [
					'Maintains close contact with the electorate and consults them on issues before the assembly',
					'Presents the views, opinions and proposals of the electorate to the assembly',
					'Attends sessions of the assembly and its committees',
					'Provides a linkage between the assembly and the electorate on public service delivery',
					'Extends professional knowledge and skills to issues before the assembly'
				]
			}
		]
	}
};
