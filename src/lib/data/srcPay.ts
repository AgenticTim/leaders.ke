// SRC (Salaries and Remuneration Commission) gazetted monthly GROSS pay by seat,
// for the current review cycle effective 1 July 2024. Figures are the gross
// monthly salary the office draws; they exclude the seat-variable perks SRC sets
// separately (mileage, car grant, house/mortgage or car loans, and, where they
// still apply. Sitting allowances). Sources: SRC gazette as reported by
// money254 and Daily Nation.
//   https://www.money254.co.ke/post/how-your-mp-mca-and-governors-salary-will-increase-this-month-news
//   https://nation.africa/kenya/news/src-keeps-president-salary-at-sh1-4m-dp-sh1-2m-as-mps-lose-sitting-allowances-3895122
export type SrcPay = { monthlyGross: number };

// Keyed by the same position titles seat.ts uses. A Woman Rep is a member of the
// National Assembly, so draws the same package as an MP/Senator.
export const SRC_PAY_BY_TITLE: Record<string, SrcPay> = {
	President: { monthlyGross: 1_443_750 },
	'Deputy President': { monthlyGross: 1_227_188 },
	Governor: { monthlyGross: 1_056_000 },
	Senator: { monthlyGross: 739_600 },
	'Woman Rep': { monthlyGross: 739_600 },
	MP: { monthlyGross: 739_600 },
	MCA: { monthlyGross: 164_588 }
};

/** Attribution line for the salary figures, shown alongside the amount. */
export const SRC_EFFECTIVE = 'effective 1 July 2024';
