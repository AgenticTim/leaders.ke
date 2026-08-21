// Hand-researched profile dossiers for a small set of high-profile people, used to
// bring a thin or missing profile up to the depth the public page and the profile
// AI both assume: a bio, a full education/professional timeline, the elective terms
// they held, pinned Delivery items, Knowledge-tab FAQ and one source document.
//
// Distinct from scripts/data/notable-knowledge.ts and notable-deliveries.ts, which
// each cover ONE tab for people who are already seeded. This file is the whole
// person, and it creates the `users` row when the person is absent from the register
// altogether (Justin Muturi holds no seat the scraped roster covers: Speaker,
// Attorney General and Cabinet Secretary are all appointive).
//
// Every fact here comes from a public, checkable source, cited inline per person.
// Where a source gives only a year, the row carries a year and no day. Where no
// source gives a date at all, the row carries null rather than a guess: a wrong date
// is stated to citizens as fact and is worse than a missing one.
//
// Applied by scripts/seed-notable-profiles.ts. Keyed by `users.slug`.

/** One education or professional history line. `fixDates` overwrites dates already
 * on a matched row, for correcting an earlier seeder's approximation; without it the
 * applier only fills dates that are null. */
export type ProfileExperience = {
	kind: 'education' | 'professional';
	title: string;
	institution: string;
	description: string;
	startAt: string | null;
	endAt: string | null;
	fixDates?: boolean;
};

/** An elective or nominated seat the person held, seeded as its own `leaders` row
 * (Track Record), never as an experience line. `description` is the seat-name
 * qualifier for a constituency that has since been renamed or redrawn. */
export type ProfileTerm = {
	positionTitle: string;
	region: string;
	status: 'current' | 'former';
	description?: string;
	party?: string;
	startAt: string;
	endAt: string | null;
};

/** What a Delivery item hangs off: either one of the person's held terms, or one
 * non-elective role. Both are supported by the schema and both render in the
 * profile's Delivered panel, grouped under the seat or role they belong to. */
export type DeliveryAnchor =
	| { kind: 'term'; positionTitle: string; region: string }
	| { kind: 'experience'; title: string; institution: string };

export type ProfileDelivery = { anchor: DeliveryAnchor; title: string; description: string };

export type ProfileFaq = { question: string; answer: string };
export type ProfileDocument = { title: string; filename: string; content: string };

export type NotableProfile = {
	/** Display name, also the source of the seed email and slug when the person is
	 * created fresh. Only read on creation; an existing row is matched by slug. */
	name: string;
	dateOfBirth?: string;
	socials?: Record<string, string>;
	bio: string;
	terms?: ProfileTerm[];
	experience: ProfileExperience[];
	deliveries: ProfileDelivery[];
	faqs: ProfileFaq[];
	documents: ProfileDocument[];
};

export const NOTABLE_PROFILES: Record<string, NotableProfile> = {
	// Sources: English Wikipedia "David Maraga"; Supreme Court presidential petition
	// 1 of 2017; Judiciary of Kenya press releases; Daily Nation and Standard
	// coverage of his October 2025 United Green Movement declaration; Capital FM,
	// 19 August 2026, on the People's Forum for Electoral Preparedness.
	'david-maraga': {
		name: 'David Maraga',
		dateOfBirth: '1951-01-12',
		socials: { x: 'https://x.com/dkmaraga' },
		bio: "David Kenani Maraga is the judge who said no: the 14th Chief Justice of Kenya, who led Africa's first annulment of a sitting president's re-election and now asks voters to send that same rectitude to State House. Admitted to the bar in October 1978, he built a Nakuru practice over a quarter of a century, rose through the High Court and the Court of Appeal, and captained the Supreme Court bench that voided the August 2017 presidential result. A devout Seventh-day Adventist who never sat on Saturdays, he defended judicial independence through budget cuts and open executive defiance until his retirement on his 70th birthday in January 2021. He declared for the presidency on a United Green Movement ticket in October 2025, and in August 2026 was named a coordinator of the People's Forum for Electoral Preparedness. His campaign rests on one promise: the constitution, enforced without fear or favour.",
		experience: [
			{
				kind: 'education',
				title: 'Certificate of Primary Education',
				institution: 'Sironga DEB Primary School',
				description: 'Primary schooling in Bonyamatuta, the Nyamira County village where he was born, the first rung of a route that ran from a rural classroom to the head of the Judiciary.',
				startAt: '1961-01-01',
				endAt: '1967-12-31'
			},
			{
				kind: 'education',
				title: 'East African School Certificate',
				institution: 'Maranda High School',
				description: 'O-level schooling at Maranda in Siaya, one of the national schools that drew bright provincial students in the years after independence.',
				startAt: '1968-01-01',
				endAt: '1971-12-31'
			},
			{
				kind: 'education',
				title: 'East African Advanced Certificate of Education',
				institution: 'Kisii High School',
				description: 'A-levels at Kisii High School, the qualification that took him to the University of Nairobi law faculty in the mid-1970s.',
				startAt: '1972-01-01',
				endAt: '1973-12-31'
			},
			{
				kind: 'education',
				title: 'Postgraduate Diploma in Law',
				institution: 'Kenya School of Law',
				description: 'The advocates training course, completed in 1978. He was admitted to the roll of advocates in October of that year and went straight into practice in Nakuru rather than into government service.',
				startAt: '1977-01-01',
				endAt: '1978-12-31'
			},
			{
				kind: 'education',
				title: 'Master of Laws (LL.M)',
				institution: 'University of Nairobi',
				description: "A master's in law taken in 2011, while sitting as a High Court judge and shortly before his elevation to the Court of Appeal.",
				startAt: '2011-01-01',
				endAt: '2011-12-31'
			},
			{
				kind: 'professional',
				title: 'Chairperson',
				institution: 'Rift Valley Law Society',
				description: 'Led the Rift Valley branch of the profession from 1987 to 1989, his first elected office of any kind, held while running his Nakuru practice.',
				startAt: '1987-01-01',
				endAt: '1989-12-31'
			},
			{
				kind: 'professional',
				title: 'Chair, Judiciary Committee on Elections',
				institution: 'Judiciary of Kenya',
				description: "Appointed vice chair of the Judiciary Working Committee on Election Preparations in May 2012 and chair of its successor, the Judiciary Committee on Elections, in August 2015. The assignment made him the courts' electoral-law specialist and put him in charge of readying judges and magistrates for election petitions.",
				startAt: '2012-05-01',
				endAt: '2016-10-01'
			},
			{
				kind: 'professional',
				title: 'Chief Justice & President of the Supreme Court',
				institution: 'Judiciary of Kenya',
				description: "Kenya's 14th Chief Justice, sworn in on 19 October 2016 after a unanimous National Assembly approval, and retired on 12 January 2021, his 70th birthday, under Article 167 of the Constitution. He led the bench that nullified the 2017 presidential election and defended judicial independence through sustained executive pressure.",
				startAt: '2016-10-19',
				endAt: '2021-01-12',
				fixDates: true
			},
			{
				kind: 'professional',
				title: 'Presidential Candidate',
				institution: 'United Green Movement',
				description: 'Declared for the 2027 presidency in October 2025 on a United Green Movement ticket, standing outside the United Opposition coalition with his own party vehicle. His platform is built on anti-corruption enforcement, constitutionalism and the independence of state institutions.',
				startAt: '2025-10-01',
				endAt: null
			}
		],
		deliveries: [
			{
				anchor: { kind: 'experience', title: 'Chief Justice & President of the Supreme Court', institution: 'Judiciary of Kenya' },
				title: 'Led the first annulment of a presidential election in Africa',
				description: 'On 1 September 2017 the Supreme Court, by a four to two majority he led, voided the 8 August presidential result for illegalities and irregularities and ordered a fresh poll. No African court had ever set aside a sitting president\'s re-election.'
			},
			{
				anchor: { kind: 'experience', title: 'Chief Justice & President of the Supreme Court', institution: 'Judiciary of Kenya' },
				title: 'Advised the President to dissolve Parliament over the gender rule',
				description: "On 21 September 2020 he advised the President to dissolve Parliament for failing to enact the two-thirds gender rule within the deadline the 2010 Constitution set. The advisory was frozen by the High Court, but it forced the country's longest-ignored constitutional obligation into the open."
			},
			{
				anchor: { kind: 'experience', title: 'Chief Justice & President of the Supreme Court', institution: 'Judiciary of Kenya' },
				title: 'Held the line on 41 blocked judicial appointments',
				description: 'Publicly and repeatedly confronted the executive over its refusal to appoint 41 judges nominated by the Judicial Service Commission, and over budget cuts to the Judiciary, treating both as attacks on the separation of powers rather than as administrative disputes.'
			},
			{
				anchor: { kind: 'experience', title: 'Chair, Judiciary Committee on Elections', institution: 'Judiciary of Kenya' },
				title: 'Built the courts’ election-dispute machinery before 2017',
				description: 'Chaired the Judiciary Committee on Elections from August 2015, training judges and magistrates and setting the case-management rules under which the 2017 petitions were heard within their constitutional timelines.'
			},
			{
				anchor: { kind: 'experience', title: 'Chief Justice & President of the Supreme Court', institution: 'Judiciary of Kenya' },
				title: 'Chaired the tribunal that removed a High Court judge',
				description: "Named in 2013 to chair the tribunal investigating Justice Joseph Mutava's conduct over the Goldenberg scandal. The tribunal recommended his removal in September 2016, and the Supreme Court affirmed it in March 2019."
			}
		],
		faqs: [
			{
				question: 'Who is David Maraga?',
				answer: 'David Kenani Maraga (born 12 January 1951 in Bonyamatuta, Nyamira County) is a Kenyan lawyer and jurist who served as the 14th Chief Justice of Kenya and President of the Supreme Court from 19 October 2016 to 12 January 2021. He is best known for leading the bench that nullified the August 2017 presidential election. He declared his candidacy for the 2027 presidency in October 2025.'
			},
			{
				question: "What is David Maraga's educational background?",
				answer: 'He attended Sironga DEB Primary School (1961 to 1967), Maranda High School for O-levels (1968 to 1971) and Kisii High School for A-levels (1972 to 1973). He earned a Bachelor of Laws from the University of Nairobi in 1977, completed the advocates course at the Kenya School of Law in 1978, and returned to the University of Nairobi for a Master of Laws in 2011.'
			},
			{
				question: 'What did David Maraga do before he became a judge?',
				answer: 'He was admitted to the bar in October 1978 and ran his own practice, Maraga & Company Advocates, in Nakuru for about 25 years, doing civil and criminal litigation and conveyancing. He chaired the Rift Valley Law Society from 1987 to 1989. He joined the bench in October 2003 when President Mwai Kibaki appointed him a judge of the High Court.'
			},
			{
				question: 'What was his judicial career before becoming Chief Justice?',
				answer: 'He sat as a High Court judge in Mombasa (2003 to 2007), Nakuru (2008 to 2010, as resident judge from May 2009) and Nairobi (2010 to 2011, presiding over the Family Division). He was vetted by the Judges and Magistrates Vetting Board in 2012 and unanimously found fit to continue. He was elevated to the Court of Appeal in January 2012 and was its presiding judge in Kisumu from October 2014 until his appointment as Chief Justice.'
			},
			{
				question: 'Why did the Supreme Court nullify the 2017 presidential election?',
				answer: 'On 1 September 2017 a four to two majority of the Supreme Court, led by Chief Justice Maraga, voided the 8 August presidential result on the grounds of illegalities and irregularities in the conduct of the election, and ordered a fresh poll within 60 days. Deputy Chief Justice Philomena Mwilu and Justices Isaac Lenaola and Smokin Wanjala were in the majority; Justices Njoki Ndung’u and J.B. Ojwang dissented. Delivering the ruling, Maraga said the greatness of any nation lies in its fidelity to the Constitution and adherence to the rule of law. It was the first time an African court had annulled a sitting president’s re-election.'
			},
			{
				question: 'What was his relationship with the executive as Chief Justice?',
				answer: 'It was openly adversarial after 2017. He publicly protested budget cuts to the Judiciary and the executive’s refusal to appoint 41 judges nominated by the Judicial Service Commission. In September 2020 he advised the President to dissolve Parliament for failing to enact the two-thirds gender rule. Several petitions seeking his removal were filed between 2019 and 2020; none succeeded, and a 2020 child-support claim against him was dismissed by the Children’s Court weeks after it was filed.'
			},
			{
				question: 'Why is he called a Seventh-day Adventist judge?',
				answer: 'He is a practising member of the Seventh-day Adventist Church and declined to sit in court on Saturdays throughout his judicial career, an accommodation the Judiciary made for him. During his 2012 vetting he swore on the Bible that he had never taken a bribe and never would.'
			},
			{
				question: 'When did he retire and why?',
				answer: 'He retired on 12 January 2021, his 70th birthday. Article 167 of the 2010 Constitution caps a Chief Justice at ten years in office or age 70, whichever comes first. Deputy Chief Justice Philomena Mwilu acted in the role until Martha Koome was appointed the 15th Chief Justice.'
			},
			{
				question: 'Is David Maraga running for president in 2027?',
				answer: 'Yes. He declared his candidacy in October 2025 and named the United Green Movement as his party vehicle. He is running outside the United Opposition coalition of Kalonzo Musyoka, Martha Karua, Eugene Wamalwa and Justin Muturi, having formed his own party rather than join theirs.'
			},
			{
				question: 'What is the People’s Forum for Electoral Preparedness?',
				answer: 'It is a forum convened for 9 October 2026 by the United Alternative Government of Kenya and the Linda Mwananchi Movement, to be coordinated by David Maraga, former Attorney General Justin Muturi and Suba South MP Caroli Omondi. Announced on 19 August 2026, it is meant to bring together Kenyans concerned about political violence and the neutrality of the security agencies ahead of 2027. The organisers said the 2027 election must be a contest of ideas rather than intimidation, of ballots rather than bullets.'
			},
			{
				question: 'What has he done since leaving the bench?',
				answer: 'He has remained a public critic of executive overreach and has taken part in civic protest, including a brief arrest on 8 June 2026 during a demonstration against construction works in Nairobi National Park. He held a presidential campaign fundraiser on 23 July 2025, at which he promised full transparency about his campaign funding.'
			}
		],
		documents: [
			{
				title: 'David Maraga: career timeline and public record',
				filename: 'david-maraga-timeline.txt',
				content: [
					'DAVID KENANI MARAGA: CAREER TIMELINE AND PUBLIC RECORD',
					'Compiled from public sources for vote.ke. Last reviewed August 2026.',
					'',
					'PERSONAL',
					'Born 12 January 1951 at Bonyamatuta, then South Nyanza District, now Nyamira County.',
					'Practising Seventh-day Adventist; declined to sit in court on Saturdays throughout his judicial career.',
					'Married to Yucabeth Nyaboke; three children.',
					'Holder of the Elder of the Order of the Golden Heart (EGH).',
					'',
					'EDUCATION',
					'1961 to 1967: Sironga DEB Primary School, Certificate of Primary Education.',
					'1968 to 1971: Maranda High School, East African School Certificate (O-level).',
					'1972 to 1973: Kisii High School, East African Advanced Certificate of Education (A-level).',
					'1977: University of Nairobi, Bachelor of Laws.',
					'1978: Kenya School of Law, postgraduate diploma. Admitted to the bar in October 1978.',
					'2011: University of Nairobi, Master of Laws.',
					'',
					'LEGAL PRACTICE',
					'1978 to 2003: private practice in Nakuru through Maraga & Company Advocates, specialising in civil and criminal litigation and conveyancing.',
					'1987 to 1989: chairperson, Rift Valley Law Society.',
					'',
					'JUDICIAL CAREER',
					'October 2003: appointed a judge of the High Court by President Mwai Kibaki.',
					'2003 to 2007: High Court, Mombasa. 2008 to 2010: High Court, Nakuru, resident judge from May 2009. 2010 to 2011: High Court, Nairobi, presiding judge of the Family Division from April 2010.',
					'2012: vetted by the Judges and Magistrates Vetting Board and unanimously declared fit to continue.',
					'January 2012: elevated to the Court of Appeal. October 2014 to October 2016: presiding judge, Court of Appeal, Kisumu.',
					'May 2012: appointed vice chair of the Judiciary Working Committee on Election Preparations. August 2015: appointed chair of its successor, the Judiciary Committee on Elections.',
					'2013: named chair of the tribunal investigating the conduct of Justice Joseph Mutava over the Goldenberg scandal. The tribunal recommended removal in September 2016; the Supreme Court affirmed it in March 2019.',
					'',
					'CHIEF JUSTICE, 19 OCTOBER 2016 TO 12 JANUARY 2021',
					'Applied in June 2016 following the early retirement of Chief Justice Willy Mutunga, competing against Makau Mutua, Jackton Ojwang, Smokin Wanjala, Aaron Ringera and Alnashir Visram among others. Unanimously approved by the National Assembly on 18 October 2016 and sworn in the following day as the 14th Chief Justice.',
					'1 September 2017: led the Supreme Court majority that nullified the 8 August presidential election for illegalities and irregularities and ordered a fresh poll within 60 days. Majority: Maraga, Deputy Chief Justice Philomena Mwilu, Justices Isaac Lenaola and Smokin Wanjala. Dissent: Justices Njoki Ndung’u and J.B. Ojwang. The first annulment of a sitting president’s re-election by an African court.',
					'21 September 2020: advised the President to dissolve Parliament over its failure to enact the two-thirds gender rule within the five-year deadline set by the 2010 Constitution. The High Court froze the advisory.',
					'Throughout the tenure: publicly opposed cuts to the Judiciary budget and the executive’s refusal to appoint 41 judges nominated by the Judicial Service Commission.',
					'Retired 12 January 2021 on turning 70, as Article 167 of the Constitution requires.',
					'',
					'SINCE RETIREMENT',
					'23 July 2025: held a presidential campaign fundraiser and pledged transparency on campaign funding.',
					'October 2025: declared for the 2027 presidency, naming the United Green Movement as his party vehicle. He stands outside the United Opposition coalition.',
					'8 June 2026: briefly arrested during a protest against construction works in Nairobi National Park.',
					'19 August 2026: named, with former Attorney General Justin Muturi and Suba South MP Caroli Omondi, as a coordinator of the People’s Forum for Electoral Preparedness, convened for 9 October 2026 by the United Alternative Government of Kenya and the Linda Mwananchi Movement.'
				].join('\n')
			}
		]
	},

	// Sources: English Wikipedia "Martha Karua"; Kenya Gazette records of the 2003
	// and 2005 ministerial appointments; IEBC 2013 and 2017 results; Daily Nation
	// coverage of the February 2025 NARC-Kenya rebrand to the People's Liberation
	// Party and of the United Opposition flagbearer talks.
	'martha-karua': {
		name: 'Martha Karua',
		dateOfBirth: '1957-09-22',
		socials: { x: 'https://x.com/MarthaKarua' },
		bio: "Martha Wangari Karua is the iron lady of Kenyan politics: magistrate turned second-liberation lawyer, reforming justice minister, and party leader now making her boldest bid yet for the presidency. She defended political prisoners when doing so was dangerous, held Gichugu for two decades from 1993, and steered the justice docket through the 2005 constitutional referendum and the 2008 National Accord talks before resigning on principle in April 2009 over judicial appointments made without her knowledge. In 2022 she became the first woman on a leading Kenyan presidential ticket as Raila Odinga's running mate. She leads the People's Liberation Party, the NARC-Kenya she rebranded in February 2025, and sits in the United Opposition alongside Kalonzo Musyoka, Eugene Wamalwa and Justin Muturi. Her regional human rights work has twice seen her deported, from Tanzania in May 2025 and from Uganda in June 2026.",
		experience: [
			{
				kind: 'professional',
				title: 'District Magistrate',
				institution: 'Judiciary of Kenya',
				description: 'Sat as a magistrate at Makadara, Nakuru and Kibera courts from 1981 to 1987, earning a reputation for careful discernment, before leaving the bench for private practice and the political fight over multiparty democracy.',
				startAt: '1981-01-01',
				endAt: '1987-12-31'
			},
			{
				kind: 'professional',
				title: 'Minister for Water Resources Management and Development',
				institution: 'Government of Kenya',
				description: 'Held the water docket from 3 January 2003 to 24 November 2005 in the first NARC government, implementing the Water Act 2002 that separated policy from regulation and service delivery and created the water services boards.',
				startAt: '2003-01-03',
				endAt: '2005-11-24'
			},
			{
				kind: 'professional',
				title: 'Presidential Candidate',
				institution: "People's Liberation Party",
				description: 'Ran for president on the NARC-Kenya ticket in 2013, placing sixth with 43,881 votes and giving up her safe Gichugu seat to do so, since the 2010 Constitution bars running for two offices at once. She carries the party into the 2027 race under its People’s Liberation Party name.',
				startAt: '2013-01-01',
				endAt: null
			},
			{
				kind: 'professional',
				title: 'Regional Human Rights Counsel',
				institution: 'East African Courts and Tribunals',
				description: 'Has appeared for opposition figures across the region, including Kizza Besigye in Uganda and Tundu Lissu in Tanzania. She was deported from Tanzania on 18 May 2025 on arrival in Dar es Salaam, and detained at Entebbe and deported from Uganda on 22 June 2026 while supporting Besigye. She has also litigated at the East African Court of Justice against the Kenyan government over judicial failure.',
				startAt: '2016-01-01',
				endAt: null
			}
		],
		deliveries: [
			{
				anchor: { kind: 'experience', title: 'Minister for Justice, National Cohesion and Constitutional Affairs', institution: 'Government of Kenya' },
				title: 'Led the government team in the 2008 National Accord talks',
				description: 'Headed the government negotiating team through the mediation that ended the 2007 to 2008 post-election violence and produced the National Accord and the grand coalition government announced on 13 April 2008.'
			},
			{
				anchor: { kind: 'experience', title: 'Minister for Justice, National Cohesion and Constitutional Affairs', institution: 'Government of Kenya' },
				title: 'Resigned from Cabinet on principle in April 2009',
				description: 'Quit the justice docket on 6 April 2009 after President Kibaki appointed judges without her knowledge, citing frustration at being unable to discharge her duties. She was the first minister to resign voluntarily since 2003.'
			},
			{
				anchor: { kind: 'experience', title: 'Minister for Water Resources Management and Development', institution: 'Government of Kenya' },
				title: 'Implemented the Water Act 2002',
				description: 'Rolled out the reform that split water policy, regulation and service delivery and stood up the water services boards, accelerating provision in the first years of the NARC government.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Gichugu' },
				title: 'Held Gichugu for two decades, 1993 to 2013',
				description: 'Won the seat in the December 1992 multiparty election against incumbent Geoffrey Karekia Kariithi and held it from 26 January 1993 to 28 March 2013, becoming the first woman lawyer popularly elected to the Kenyan Parliament.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Gichugu' },
				title: 'Recorded the lone objection to the 2001 Constitutional Review Bill',
				description: 'Opposed the Bill but stayed in the chamber as the only opposition member present, so that the objections would enter the Hansard record rather than disappear with a walkout.'
			}
		],
		faqs: [
			{
				question: 'Who is Martha Karua?',
				answer: 'Martha Wangari Karua (born 22 September 1957 in Gichugu, Kirinyaga County) is a Kenyan lawyer and politician. She was MP for Gichugu from 1993 to 2013, Minister for Water from 2003 to 2005, Minister for Justice, National Cohesion and Constitutional Affairs from 2005 to 2009, and Raila Odinga’s running mate in 2022. She leads the People’s Liberation Party and is a candidate in the 2027 presidential race.'
			},
			{
				question: "What is Martha Karua's educational background?",
				answer: 'She attended Mugumo Primary School and a succession of secondary schools including Kabare Girls, St Michael’s Keroguya, Kiburia Girls, Ngiriambu Girls and Karoti Girls, sitting her A-levels at Nairobi Girls. She read law at the University of Nairobi from 1977 to 1980 and completed the postgraduate course at the Kenya School of Law in 1981. She later took a Master of Business Administration at USIU-Africa in Nairobi.'
			},
			{
				question: 'What did she do before entering politics?',
				answer: 'She was a district magistrate at Makadara, Nakuru and Kibera courts from 1981 to 1987, then left the bench and founded Martha Karua & Co. Advocates in 1987. In private practice she took political and human rights briefs at real personal risk under the Moi government, including the treason trial of Koigi Wamwere and the case of MP Mirugi Kariuki, and contributed to the development of matrimonial property law.'
			},
			{
				question: 'What is her parliamentary record?',
				answer: 'She won Gichugu in the December 1992 multiparty election, defeating the incumbent Geoffrey Karekia Kariithi, and served from 26 January 1993 to 28 March 2013, twenty years in the seat. She was the first woman lawyer popularly elected to Parliament. She served as the Democratic Party’s legal affairs secretary and National Secretary for Constitutional Affairs, declined a shadow minister post in 1998 to keep the constitutional affairs brief, and in 2001 stayed in the chamber as the lone opposition member to place her objections to the Constitutional Review Bill on the Hansard record.'
			},
			{
				question: 'What did she achieve as Minister for Justice?',
				answer: 'She held the justice, national cohesion and constitutional affairs docket from 7 December 2005 to 6 April 2009. She steered the docket through the 2005 constitutional referendum, and headed the government negotiating team during the 2007 to 2008 post-election crisis, work that produced the National Accord and the grand coalition Cabinet announced on 13 April 2008.'
			},
			{
				question: 'Why did she resign from the Cabinet in 2009?',
				answer: 'She resigned on 6 April 2009, saying she could not discharge her duties. Days earlier President Kibaki had appointed judges without her knowledge, despite judicial reform sitting squarely in her docket. She was the first Kenyan minister to resign voluntarily since 2003, and the resignation became the defining act of her reputation for principle.'
			},
			{
				question: 'What happened in her presidential and gubernatorial runs?',
				answer: 'She ran for president on the NARC-Kenya ticket in 2013 and placed sixth with 43,881 votes, giving up her safe Gichugu seat to do so. In 2017 she ran for governor of Kirinyaga and lost to Anne Waiguru by 122,091 votes to 161,373, then challenged the result through the High Court, Court of Appeal and Supreme Court without success, and afterwards filed at the East African Court of Justice against the Kenyan government over judicial failure.'
			},
			{
				question: 'What was her role in the 2022 election?',
				answer: 'Raila Odinga named her his running mate on 3 June 2022, making her the first woman to run on a major party presidential ticket in Kenya. Had the Azimio la Umoja coalition won the August 2022 election she would have become the country’s first female Deputy President.'
			},
			{
				question: 'What is the People’s Liberation Party?',
				answer: 'It is the party she has led since 2008, founded as NARC-Kenya and rebranded the People’s Liberation Party in February 2025. She carries it into the 2027 presidential race, and it sits within the United Opposition alongside Kalonzo Musyoka’s Wiper, Eugene Wamalwa’s DAP-Kenya and Justin Muturi’s Democratic Party. The coalition has yet to settle how it will pick a single flagbearer.'
			},
			{
				question: 'Why was she deported from Tanzania and Uganda?',
				answer: 'She has acted for opposition figures across East Africa. Tanzania deported her on 18 May 2025 on arrival at Julius Nyerere International Airport, where she had travelled in connection with Tundu Lissu. Uganda detained her at Entebbe International Airport and deported her on 22 June 2026 while she was supporting Kizza Besigye. She has treated both as evidence that the shrinking of civic space is a regional problem, not a Kenyan one.'
			},
			{
				question: 'What awards has she received?',
				answer: 'Human Rights Watch recognised her as a human rights monitor in 1991. FIDA-Kenya honoured her in December 1995 for advancing the cause of women. In 1999 the Kenyan section of the International Commission of Jurists named her Jurist of the Year, and the Law Society of Kenya gave her its Legal Practitioners Due Diligence Award. She holds the Elder of the Order of the Golden Heart and the rank of Senior Counsel, and she is the author of the memoir Against The Tide.'
			}
		],
		documents: [
			{
				title: 'Martha Karua: career timeline and public record',
				filename: 'martha-karua-timeline.txt',
				content: [
					'MARTHA WANGARI KARUA: CAREER TIMELINE AND PUBLIC RECORD',
					'Compiled from public sources for vote.ke. Last reviewed August 2026.',
					'',
					'PERSONAL',
					'Born 22 September 1957 in Gichugu, then Embu District, now Kirinyaga County. Second of eight children. Two children.',
					'Senior Counsel; Elder of the Order of the Golden Heart. Author of the memoir Against The Tide.',
					'',
					'EDUCATION',
					'Mugumo Primary School. Secondary schooling at Kabare Girls, St Michael’s Keroguya, Kiburia Girls, Ngiriambu Girls and Karoti Girls, with A-levels at Nairobi Girls.',
					'1977 to 1980: University of Nairobi, Bachelor of Laws. 1980 to 1981: Kenya School of Law. Admitted to the roll of advocates in 1981.',
					'Later: Master of Business Administration, USIU-Africa, Nairobi.',
					'',
					'LEGAL CAREER',
					'1981 to 1987: district magistrate at Makadara, Nakuru and Kibera courts.',
					'1987 to 2002: private practice through Martha Karua & Co. Advocates. Notable briefs include the treason trial of Koigi Wamwere and the case of MP Mirugi Kariuki. Worked with FIDA-Kenya and the League of Kenya Women Voters on public interest litigation.',
					'Regional work: counsel to Kizza Besigye in Uganda and Tundu Lissu in Tanzania. Deported from Tanzania on 18 May 2025 and from Uganda on 22 June 2026.',
					'',
					'PARLIAMENT',
					'26 January 1993 to 28 March 2013: MP for Gichugu, won in December 1992 against incumbent Geoffrey Karekia Kariithi. First woman lawyer popularly elected to the Kenyan Parliament.',
					'1993: Democratic Party legal affairs secretary; later National Secretary for Constitutional Affairs.',
					'1998: declined a shadow minister post to keep the constitutional affairs brief.',
					'2001: opposed the Constitutional Review Bill and remained in the chamber as the lone opposition member so the objections entered the Hansard record.',
					'2002: helped form the NARC coalition that ended KANU’s forty years in power.',
					'',
					'CABINET',
					'3 January 2003 to 24 November 2005: Minister for Water Resources Management and Development. Implemented the Water Act 2002.',
					'7 December 2005 to 6 April 2009: Minister for Justice, National Cohesion and Constitutional Affairs. Steered the 2005 constitutional referendum; headed the government negotiating team in the 2007 to 2008 post-election crisis; stayed in the grand coalition Cabinet announced 13 April 2008.',
					'6 April 2009: resigned, citing inability to discharge her duties after President Kibaki appointed judges without her knowledge. First voluntary ministerial resignation since 2003.',
					'',
					'ELECTIONS',
					'2013 presidential: NARC-Kenya ticket, sixth place with 43,881 votes. Gave up the Gichugu seat to run.',
					'2017 Kirinyaga governor: 122,091 votes against Anne Waiguru’s 161,373. Petition dismissed through the High Court, Court of Appeal and Supreme Court; case then filed at the East African Court of Justice.',
					'2022: named Raila Odinga’s running mate on 3 June 2022, the first woman on a major party presidential ticket in Kenya.',
					'2027: presidential candidate. Leads the People’s Liberation Party, the NARC-Kenya rebranded in February 2025, within the United Opposition alongside Wiper, DAP-Kenya and the Democratic Party.',
					'',
					'AWARDS',
					'1991: Human Rights Watch recognition as a human rights monitor.',
					'December 1995: FIDA-Kenya award for advancing the cause of women.',
					'1999: Kenya Jurist of the Year, International Commission of Jurists (Kenya). Law Society of Kenya Legal Practitioners Due Diligence Award.'
				].join('\n')
			}
		]
	},

	// Sources: The Star and Citizen Digital reports of the August 2022 Suba South
	// result; the Kenyan Parliament member directory; Mzalendo's 13th Parliament
	// performance record; Kenyans.co.ke on his August 2025 election as chair of the
	// Constitutional Implementation Oversight Committee; Capital FM, 19 August 2026.
	'caroli-omondi': {
		name: 'Caroli Omondi',
		socials: { x: 'https://x.com/CaroliOmondi' },
		bio: "Caroli Omondi is the constitutional lawyer who ran Raila Odinga's engine room and then went to Parliament in his own right. He spent eight years as a Senior State Counsel in the State Law Office, served as chief counsel at the African Trade Insurance Agency, and was Chief of Staff in the Office of the Prime Minister through the whole life of the Grand Coalition government, from 2008 to 2013. In August 2022 he won Suba South for ODM with 25,036 votes, succeeding John Mbadi, and he now chairs the National Assembly's Constitutional Implementation Oversight Committee. One of the more active members of the 13th Parliament by recorded contributions, he has sponsored the Education Laws (Amendment) Bill and co-sponsored the Registration of Persons (Amendment) Bill, and in August 2026 was named a coordinator of the People's Forum for Electoral Preparedness alongside David Maraga and Justin Muturi.",
		experience: [
			{
				kind: 'education',
				title: 'Bachelor of Laws (LL.B)',
				institution: 'University of Nairobi',
				description: 'Read law at the University of Nairobi from 1987, the training behind a career spent almost entirely on constitutional and public law, in government service and later in the House.',
				startAt: '1987-01-01',
				endAt: '1990-12-31'
			},
			{
				kind: 'education',
				title: 'Diploma in Law (Advocates Training Programme)',
				institution: 'Kenya School of Law',
				description: 'Completed the advocates training programme in 1991 and went straight into the State Law Office rather than private practice.',
				startAt: '1990-01-01',
				endAt: '1991-12-31'
			},
			{
				kind: 'education',
				title: 'Master of Laws (LL.M)',
				institution: 'University of Nottingham',
				description: 'Postgraduate law at Nottingham in the early 1990s, taken while serving as a State Counsel and sharpening the public and commercial law specialism he later carried into the Office of the Prime Minister.',
				startAt: '1992-01-01',
				endAt: '1993-12-31'
			},
			{
				kind: 'education',
				title: 'Executive Management Programme',
				institution: 'Harvard Business School',
				description: 'Executive management training at Harvard in 2006, between his years in multilateral insurance and his move into the centre of government.',
				startAt: '2006-01-01',
				endAt: '2006-12-31'
			},
			{
				kind: 'professional',
				title: 'Senior State Counsel',
				institution: 'State Law Office, Government of Kenya',
				description: 'Eight years at the State Law Office from 1991, litigating for the government and drafting policy and legislation, the grounding for the constitutional-law specialism he is known for in the House.',
				startAt: '1991-01-01',
				endAt: '1999-12-31'
			},
			{
				kind: 'professional',
				title: 'Chief Counsel',
				institution: 'African Trade Insurance Agency',
				description: 'Seven years as chief counsel at the African Trade Insurance Agency, the multilateral political-risk and trade-credit insurer, before joining the Office of the Prime Minister.',
				startAt: null,
				endAt: null
			},
			{
				kind: 'professional',
				title: 'Chief of Staff',
				institution: 'Office of the Prime Minister',
				description: 'Ran the Prime Minister’s office under Raila Odinga for the full life of the Grand Coalition government, from 2008 to 2013, advising on policy and legislation and coordinating between the two halves of a power-sharing executive.',
				startAt: '2008-04-17',
				endAt: '2013-03-31'
			},
			{
				kind: 'professional',
				title: 'Chair, Constitutional Implementation Oversight Committee',
				institution: 'National Assembly of Kenya',
				description: 'Elected chair of the Constitutional Implementation Oversight Committee on 13 August 2025, the committee that tracks whether the 2010 Constitution is actually being put into effect.',
				startAt: '2025-08-13',
				endAt: null
			}
		],
		deliveries: [
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Suba South' },
				title: 'Elected MP for Suba South with 25,036 votes',
				description: 'Won the seat on an ODM ticket in the August 2022 general election, taking 25,036 votes across the constituency’s four wards and succeeding the outgoing member and ODM national chairman John Mbadi.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Suba South' },
				title: 'Chairs the Constitutional Implementation Oversight Committee',
				description: 'Elected chair on 13 August 2025 of the committee responsible for monitoring the implementation of the 2010 Constitution, a brief that matches his career as a constitutional lawyer in the State Law Office and the Office of the Prime Minister.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Suba South' },
				title: 'Sponsored the Education Laws (Amendment) Bill, 2025',
				description: 'Introduced the Bill in his own name; it received its first reading on 22 April 2026.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Suba South' },
				title: 'Co-sponsored the Registration of Persons (Amendment) Bill, 2025',
				description: 'Joint sponsor of the Bill amending the law on national registration, which has reached committee stage.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Suba South' },
				title: 'One of the most active contributors in the 13th Parliament',
				description: 'Mzalendo’s record of the 13th Parliament counts 301 contributions from him on the floor and in committee, and names him in 357 debate passages across 144 sittings.'
			}
		],
		faqs: [
			{
				question: 'Who is Caroli Omondi?',
				answer: 'Caroli Omondi is a Kenyan lawyer and the Member of Parliament for Suba South in Homa Bay County, elected on an Orange Democratic Movement ticket in August 2022. Before Parliament he was a Senior State Counsel, chief counsel at the African Trade Insurance Agency, and Chief of Staff in the Office of the Prime Minister under Raila Odinga from 2008 to 2013. He chairs the National Assembly’s Constitutional Implementation Oversight Committee.'
			},
			{
				question: "What is Caroli Omondi's educational background?",
				answer: 'He read law at the University of Nairobi from 1987 to 1990, took the advocates training programme at the Kenya School of Law and qualified in 1991, then earned a Master of Laws at the University of Nottingham. In 2006 he completed the Executive Management Programme at Harvard Business School.'
			},
			{
				question: 'What did he do before he became an MP?',
				answer: 'He spent from 1991 to 1999 as a Senior State Counsel in the State Law Office, handling government litigation and drafting policy and legislation. He then served seven years as chief counsel at the African Trade Insurance Agency, the multilateral political-risk insurer. From 2008 to 2013 he was Chief of Staff in the Office of the Prime Minister under Raila Odinga, at the centre of the Grand Coalition government.'
			},
			{
				question: 'How did he win Suba South?',
				answer: 'He won the seat in the August 2022 general election on an ODM ticket with 25,036 votes across the constituency’s four wards, succeeding John Mbadi, the outgoing member and ODM national chairman. His nomination was itself contested: a petition was filed in April 2022 arguing that ODM had cleared him after the deadline.'
			},
			{
				question: 'What committees does he serve on?',
				answer: 'He was elected chair of the Constitutional Implementation Oversight Committee on 13 August 2025, the committee that monitors whether the 2010 Constitution is being implemented. He has also served on the Sports and Culture committee. His committee assignments have not been stable: he was among members removed from key committees during a 2026 reshuffle of House positions.'
			},
			{
				question: 'What legislation has he sponsored?',
				answer: 'He sponsored the Education Laws (Amendment) Bill, 2025, which received its first reading on 22 April 2026, and is a joint sponsor of the Registration of Persons (Amendment) Bill, 2025, which has reached committee stage.'
			},
			{
				question: 'How active is he in Parliament?',
				answer: 'Mzalendo’s record for the 13th Parliament counts 301 contributions from him, 86 of them in 2026, and names him in 357 debate passages across 144 sittings. That puts him among the more active members of the House, concentrated on governance, budget accountability and constitutional matters.'
			},
			{
				question: 'What is his relationship with ODM?',
				answer: 'He was elected on an ODM ticket in 2022 after returning to the party following talks with Raila Odinga, having left it in 2017. He has said he was among the founders of ODM. He has also faced internal discipline: in 2023 the party moved to expel him over what it saw as alignment with Kenya Kwanza.'
			},
			{
				question: 'What is the People’s Forum for Electoral Preparedness?',
				answer: 'It is a forum convened for 9 October 2026 by the United Alternative Government of Kenya and the Linda Mwananchi Movement, to be coordinated by Caroli Omondi, former Chief Justice David Maraga and former Attorney General Justin Muturi. Announced on 19 August 2026, it is meant to gather Kenyans concerned about political violence and the neutrality of the security agencies before the 2027 election.'
			},
			{
				question: 'What has he said about the 13th Parliament?',
				answer: 'He has publicly criticised the House he sits in, blaming political parties for what he calls a weak 13th Parliament. He describes himself as the top constitutional lawyer of his class, and is known around Parliament for running half a marathon every three days.'
			}
		],
		documents: [
			{
				title: 'Caroli Omondi: career timeline and parliamentary record',
				filename: 'caroli-omondi-timeline.txt',
				content: [
					'CAROLI OMONDI: CAREER TIMELINE AND PARLIAMENTARY RECORD',
					'Compiled from public sources for vote.ke. Last reviewed August 2026.',
					'',
					'CURRENT OFFICE',
					'Member of Parliament for Suba South, Homa Bay County, Orange Democratic Movement. Elected August 2022 with 25,036 votes, succeeding John Mbadi.',
					'Chair, Constitutional Implementation Oversight Committee, elected 13 August 2025. Has also served on the Sports and Culture committee.',
					'',
					'EDUCATION',
					'1987 to 1990: University of Nairobi, Bachelor of Laws.',
					'1990 to 1991: Kenya School of Law, Diploma in Law.',
					'1992 to 1993: University of Nottingham, Master of Laws.',
					'2006: Harvard Business School, Executive Management Programme.',
					'',
					'CAREER BEFORE PARLIAMENT',
					'1991 to 1999: Senior State Counsel, State Law Office, Government of Kenya. Government litigation, policy and legislative drafting.',
					'Seven years as chief counsel, African Trade Insurance Agency, the multilateral political-risk and trade-credit insurer.',
					'2008 to 2013: Chief of Staff, Office of the Prime Minister, under Raila Odinga. Policy, legislation and inter-governmental coordination through the whole life of the Grand Coalition government.',
					'',
					'LEGISLATIVE RECORD',
					'The Education Laws (Amendment) Bill, 2025. Sponsor. First reading 22 April 2026.',
					'The Registration of Persons (Amendment) Bill, 2025. Joint sponsor. At committee stage.',
					'301 counted contributions in the 13th Parliament, 86 of them in 2026. Named in 357 debate passages across 144 sittings (Mzalendo).',
					'Recorded votes include the Constitution of Kenya (Amendment) Bill 4 of 2025, the Rigathi Gachagua impeachment and the Finance Bill 2024.',
					'',
					'PARTY AND POLITICS',
					'Says he was among the founders of ODM. Left the party in 2017 and returned in 2022 after talks with Raila Odinga.',
					'April 2022: a petition challenged ODM’s clearance of him for the Suba South nomination as being out of time.',
					'2023: ODM moved to expel him over alignment with Kenya Kwanza.',
					'2026: removed from key House committees in a reshuffle of positions.',
					'19 August 2026: named, with former Chief Justice David Maraga and former Attorney General Justin Muturi, as a coordinator of the People’s Forum for Electoral Preparedness, convened for 9 October 2026 by the United Alternative Government of Kenya and the Linda Mwananchi Movement.'
				].join('\n')
			}
		]
	},

	// Not present in the scraped register at all: every office he is known for
	// (Speaker, Attorney General, Cabinet Secretary) is appointive, and his one
	// elective seat, Siakago, was redrawn out of existence in 2013. Sources:
	// English Wikipedia "Justin Muturi"; National Assembly Hansard for the 28 March
	// 2013 Speaker election; Daily Nation and Standard coverage of his January 2025
	// statement on his son's abduction and his 26 March 2025 dismissal; his own
	// verified X account; Capital FM, 19 August 2026.
	'justin-muturi': {
		name: 'Justin Muturi',
		dateOfBirth: '1956-04-28',
		socials: { x: 'https://x.com/HonJBMuturi' },
		bio: "Justin Bedan Njoka Muturi is the insider who turned on the government from the inside. A principal magistrate for fifteen years, MP for Siakago from 1999, and Speaker of the National Assembly for two full terms from 2013 to 2022, he presided over the first Parliament elected under the 2010 Constitution. He backed Kenya Kwanza in 2022 and was appointed Attorney General, then Cabinet Secretary for Public Service. In January 2025 he broke ranks publicly, telling the DCI that the National Intelligence Service had abducted his son Leslie in June 2024 and released him only after the President intervened, and naming the state in a wider pattern of abductions. He was dropped from the Cabinet on 26 March 2025. He now leads the Democratic Party of Kenya inside the United Opposition, chairs the People's Restorative Justice Commission, and in August 2026 was named a coordinator of the People's Forum for Electoral Preparedness.",
		terms: [
			{
				positionTitle: 'MP',
				region: 'Mbeere North',
				status: 'former',
				description: 'Former Siakago',
				startAt: '1999-01-01',
				endAt: '2007-12-27'
			}
		],
		experience: [
			{
				kind: 'education',
				title: 'Secondary Education',
				institution: 'Kangaru High School',
				description: 'Schooled at Kangaru in Embu, the county he would later represent in Parliament and whose politics he has been part of for more than three decades.',
				startAt: null,
				endAt: null
			},
			{
				kind: 'education',
				title: 'Bachelor of Laws (LL.B)',
				institution: 'University of Nairobi',
				description: 'Read law at the University of Nairobi from 1978 to 1981, the training behind fifteen years on the magistrates’ bench and, much later, the office of Attorney General.',
				startAt: '1978-01-01',
				endAt: '1981-12-31'
			},
			{
				kind: 'education',
				title: 'Postgraduate Diploma in Law',
				institution: 'Kenya School of Law',
				description: 'The advocates training course, after which he was admitted to the bar in 1982 as an advocate of the High Court of Kenya and joined the Judiciary rather than private practice.',
				startAt: null,
				endAt: null
			},
			{
				kind: 'professional',
				title: 'Principal Magistrate',
				institution: 'Judiciary of Kenya',
				description: 'Fifteen years on the magistrates’ bench from 1982 to 1997. A bribery allegation brought against him in 1995 ended in acquittal in 1997.',
				startAt: '1982-01-01',
				endAt: '1997-12-31'
			},
			{
				kind: 'professional',
				title: 'Opposition Chief Whip and Chair, Public Investments Committee',
				institution: 'National Assembly of Kenya',
				description: 'Held both roles from 2003 to 2007 in the 9th Parliament, running opposition floor discipline while chairing the committee that scrutinises the accounts of state corporations.',
				startAt: '2003-01-01',
				endAt: '2007-12-27'
			},
			{
				kind: 'professional',
				title: 'National Organising Secretary',
				institution: 'Kenya African National Union',
				description: 'Took over KANU’s organising brief in 2008, in the years between losing the Siakago seat and returning to Parliament as its Speaker.',
				startAt: '2008-01-01',
				endAt: '2012-12-31'
			},
			{
				kind: 'professional',
				title: 'Speaker of the National Assembly',
				institution: 'Parliament of Kenya',
				description: 'The 7th Speaker of the National Assembly, elected on 28 March 2013 by 219 votes to 129 against Kenneth Marende, and re-elected unopposed in 2017. He served two full terms to 2022, presiding over the first National Assembly elected under the 2010 Constitution and over the establishment of a working bicameral Parliament.',
				startAt: '2013-03-28',
				endAt: '2022-10-01'
			},
			{
				kind: 'professional',
				title: 'Attorney General of Kenya',
				institution: 'Office of the Attorney General',
				description: 'The 8th Attorney General, appointed on 27 October 2022 as the government’s principal legal adviser and served until 11 July 2024. He resigned the leadership of the Democratic Party to take the office.',
				startAt: '2022-10-27',
				endAt: '2024-07-11'
			},
			{
				kind: 'professional',
				title: 'Cabinet Secretary for Public Service and Human Capital Development',
				institution: 'Government of Kenya',
				description: 'Held the public service docket from 8 August 2024 until 26 March 2025, when he was dropped in a Cabinet reshuffle after months of public criticism of the government over abductions. He has said he was fired over his stand on extrajudicial killings, not for absenteeism as the President stated.',
				startAt: '2024-08-08',
				endAt: '2025-03-26'
			},
			{
				kind: 'professional',
				title: "Chairman, People's Restorative Justice Commission",
				institution: "People's Restorative Justice Commission",
				description: 'Sworn in as chairman at the commission’s launch at Ufungamano House in Nairobi in June 2025, a civil-society body he has framed as a vehicle for justice for victims of state violence.',
				startAt: '2025-06-01',
				endAt: null
			},
			{
				kind: 'professional',
				title: 'Party Leader',
				institution: 'Democratic Party of Kenya',
				description: 'Leads the Democratic Party of Kenya within the United Opposition, alongside Kalonzo Musyoka’s Wiper, Martha Karua’s People’s Liberation Party and Eugene Wamalwa’s DAP-Kenya. He has publicly endorsed Kalonzo Musyoka to carry the opposition flag in 2027 and has pressed the coalition to settle on a single candidate.',
				startAt: '2025-04-01',
				endAt: null
			}
		],
		deliveries: [
			{
				anchor: { kind: 'experience', title: 'Speaker of the National Assembly', institution: 'Parliament of Kenya' },
				title: 'Presided over the National Assembly for two full terms',
				description: 'Elected the 7th Speaker on 28 March 2013 by 219 votes to 129 against Kenneth Marende, and re-elected in 2017 with his opponent taking a single vote. He served the full 11th and 12th Parliaments, to 2022.'
			},
			{
				anchor: { kind: 'experience', title: 'Speaker of the National Assembly', institution: 'Parliament of Kenya' },
				title: 'Chaired the first Parliament under the 2010 Constitution',
				description: 'The 11th Parliament was the first elected under the new Constitution and the first to sit alongside a Senate. He presided over the working out of the two Houses’ respective mandates, including repeated disputes over money bills and county legislation.'
			},
			{
				anchor: { kind: 'experience', title: 'Attorney General of Kenya', institution: 'Office of the Attorney General' },
				title: "Served as the government's principal legal adviser, 2022 to 2024",
				description: 'Appointed the 8th Attorney General on 27 October 2022, advising the Cabinet and representing the government in court until 11 July 2024.'
			},
			{
				anchor: { kind: 'experience', title: 'Cabinet Secretary for Public Service and Human Capital Development', institution: 'Government of Kenya' },
				title: 'Named the state in his own son’s abduction while still in Cabinet',
				description: 'On 12 January 2025, while a serving Cabinet Secretary, he stated to the DCI that the National Intelligence Service had taken his son Leslie in Nairobi on 22 June 2024 and released him only after President Ruto made a phone call at his insistence. He went on to link the agency to a wider pattern of abductions. MPs threatened impeachment; he was dropped from the Cabinet on 26 March 2025.'
			},
			{
				anchor: { kind: 'term', positionTitle: 'MP', region: 'Mbeere North' },
				title: 'Chaired the Public Investments Committee, 2003 to 2007',
				description: 'Ran the committee that scrutinises the accounts of state corporations while also serving as Opposition Chief Whip in the 9th Parliament, representing Siakago, the constituency later redrawn into Mbeere North.'
			}
		],
		faqs: [
			{
				question: 'Who is Justin Muturi?',
				answer: 'Justin Bedan Njoka Muturi (born 28 April 1956 in Kanyuambora, Embu County) is a Kenyan lawyer and politician. He was a principal magistrate from 1982 to 1997, MP for Siakago from 1999 to 2007, Speaker of the National Assembly from 2013 to 2022, Attorney General from 2022 to 2024, and Cabinet Secretary for Public Service from 2024 to 2025. He leads the Democratic Party of Kenya.'
			},
			{
				question: "What is Justin Muturi's educational background?",
				answer: 'He attended Kangaru High School in Embu, then read law at the University of Nairobi from 1978 to 1981 and took the postgraduate course at the Kenya School of Law. He was admitted to the bar in 1982 as an advocate of the High Court of Kenya.'
			},
			{
				question: 'What did he do before entering politics?',
				answer: 'He served fifteen years as a principal magistrate, from 1982 to 1997. In 1995 he faced a bribery allegation involving a case before him; he was acquitted in 1997 and entered elective politics two years later.'
			},
			{
				question: 'What is his parliamentary record as an MP?',
				answer: 'He won the Siakago seat in a 1999 by-election and retained it in 2002, serving until 2007. In the 9th Parliament he was Opposition Chief Whip and chaired the Public Investments Committee, which scrutinises the accounts of state corporations. Siakago was redrawn into Mbeere North in the 2013 boundary review. He ran for Mbeere North in 2013 on a National Alliance ticket and lost to Muriuki Njagagua.'
			},
			{
				question: 'What did he do as Speaker of the National Assembly?',
				answer: 'He was elected the 7th Speaker on 28 March 2013, beating Kenneth Marende by 219 votes to 129, and was re-elected in 2017 with his opponent taking a single vote. He served two full terms to 2022, presiding over the 11th Parliament, the first National Assembly elected under the 2010 Constitution and the first to sit alongside a Senate, and over the long working out of the two Houses’ respective mandates.'
			},
			{
				question: 'When was he Attorney General?',
				answer: 'He served as the 8th Attorney General of Kenya from 27 October 2022 to 11 July 2024, the government’s principal legal adviser and its representative in court. He resigned the leadership of the Democratic Party in order to take the office, having joined Kenya Kwanza in 2022 after his own presidential bid.'
			},
			{
				question: 'What happened with the abduction of his son?',
				answer: 'On 12 January 2025, while serving as a Cabinet Secretary, he publicly stated to the DCI that officers of the National Intelligence Service had taken his son Leslie Muturi in Nairobi on 22 June 2024, during the Gen Z protests, and released him only after President William Ruto made a phone call at his insistence. He went on to link the agency to a broader pattern of abductions of government critics. MPs threatened to impeach him over the criticism.'
			},
			{
				question: 'Why was he dropped from the Cabinet?',
				answer: 'He was removed as Cabinet Secretary for Public Service and Human Capital Development in a reshuffle on 26 March 2025 and replaced by Mbeere North MP Geoffrey Ruku. The President said in a televised interview on 31 March 2025 that he had been relieved for failing to attend Cabinet meetings. Muturi rejected that account publicly, saying he did not abscond and was fired over his stand on extrajudicial killings.'
			},
			{
				question: 'Did he run for president?',
				answer: 'Yes. He sought the presidency in 2022 as leader of the Democratic Party, whose delegates resolved to back his State House bid. He did not go to the ballot as a presidential candidate, joining Kenya Kwanza before the election and being appointed Attorney General after it.'
			},
			{
				question: 'Where does he stand ahead of 2027?',
				answer: 'He leads the Democratic Party of Kenya within the United Opposition, alongside Kalonzo Musyoka’s Wiper, Martha Karua’s People’s Liberation Party and Eugene Wamalwa’s DAP-Kenya. He has endorsed Kalonzo Musyoka to carry the opposition flag against President Ruto and, with Karua, has pressed the coalition to name a single flagbearer rather than leave the question open. He also chairs the People’s Restorative Justice Commission, launched at Ufungamano House in June 2025.'
			},
			{
				question: 'What is the People’s Forum for Electoral Preparedness?',
				answer: 'It is a forum convened for 9 October 2026 by the United Alternative Government of Kenya and the Linda Mwananchi Movement, to be coordinated by Justin Muturi, former Chief Justice David Maraga and Suba South MP Caroli Omondi. Announced on 19 August 2026, it is meant to bring together Kenyans concerned about political violence and the neutrality of the security agencies ahead of the 2027 election.'
			}
		],
		documents: [
			{
				title: 'Justin Muturi: career timeline and public record',
				filename: 'justin-muturi-timeline.txt',
				content: [
					'JUSTIN BEDAN NJOKA MUTURI: CAREER TIMELINE AND PUBLIC RECORD',
					'Compiled from public sources for vote.ke. Last reviewed August 2026.',
					'',
					'PERSONAL',
					'Born 28 April 1956 at Kanyuambora, then Embu District, Central Province. Married, three children. Holder of the Elder of the Order of the Golden Heart (EGH).',
					'',
					'EDUCATION',
					'Kangaru High School, Embu.',
					'1978 to 1981: University of Nairobi, Bachelor of Laws.',
					'Kenya School of Law, postgraduate diploma. Admitted to the bar in 1982 as an advocate of the High Court of Kenya.',
					'',
					'JUDICIARY',
					'1982 to 1997: principal magistrate. A 1995 bribery allegation, concerning a case involving Geoffrey Joel Momanyi and Fellgona Akothe Momanyi, ended in acquittal in 1997.',
					'',
					'PARLIAMENT',
					'1999: won the Siakago seat in a by-election; retained it in 2002; served to 2007. Siakago was redrawn into Mbeere North in the 2013 boundary review.',
					'2003 to 2007: Opposition Chief Whip and chair of the Public Investments Committee.',
					'2008: national organising secretary, KANU.',
					'2013: ran for Mbeere North on a National Alliance ticket and lost to Muriuki Njagagua.',
					'',
					'SPEAKER OF THE NATIONAL ASSEMBLY, 2013 TO 2022',
					'28 March 2013: elected the 7th Speaker by 219 votes to 129 against Kenneth Marende.',
					'2017: re-elected; his opponent Noah Winja received one vote.',
					'Presided over the 11th Parliament, the first National Assembly elected under the 2010 Constitution and the first to sit alongside a Senate, and over the 12th.',
					'',
					'EXECUTIVE OFFICE',
					'27 October 2022 to 11 July 2024: Attorney General of Kenya, the 8th holder of the office. Resigned the Democratic Party leadership to take it, having joined Kenya Kwanza in 2022.',
					'8 August 2024 to 26 March 2025: Cabinet Secretary for Public Service and Human Capital Development. Replaced by Mbeere North MP Geoffrey Ruku.',
					'',
					'BREAK WITH THE GOVERNMENT',
					'22 June 2024: his son Leslie Muturi is taken in Nairobi during the Gen Z protests.',
					'12 January 2025: as a serving Cabinet Secretary he states to the DCI that the National Intelligence Service carried out the abduction and released his son only after President Ruto made a phone call at his insistence. He links the agency to a wider pattern of abductions. MPs threaten impeachment.',
					'26 March 2025: dropped from the Cabinet. The President says on 31 March that he was relieved for failing to attend Cabinet meetings; Muturi publicly rejects this, saying he was fired over his stand on extrajudicial killings.',
					'June 2025: sworn in as chairman of the People’s Restorative Justice Commission at its launch at Ufungamano House, Nairobi.',
					'',
					'AHEAD OF 2027',
					'Leads the Democratic Party of Kenya within the United Opposition, alongside Wiper, the People’s Liberation Party and DAP-Kenya. Has endorsed Kalonzo Musyoka as the opposition flagbearer and, with Martha Karua, has pressed the coalition to settle the question rather than leave it open.',
					'19 August 2026: named, with former Chief Justice David Maraga and Suba South MP Caroli Omondi, as a coordinator of the People’s Forum for Electoral Preparedness, convened for 9 October 2026 by the United Alternative Government of Kenya and the Linda Mwananchi Movement.'
				].join('\n')
			}
		]
	}
};
