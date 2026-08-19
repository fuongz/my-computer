/**
 * Who draws, where, and on which days.
 *
 * Every southern and central province runs its own lottery on fixed weekdays —
 * Hậu Giang only on Saturday, Hồ Chí Minh on Monday and Saturday — and a
 * province never draws on any other day. Holding that here rather than asking
 * the site is what lets the panel answer "Hậu Giang chỉ xổ Thứ Bảy" without
 * spending a request, and it is the check that makes the date trap in api.ts
 * survivable: xskt.com.vn answers a date a province did not draw with the same
 * day from some other year rather than with nothing.
 *
 * The schedule was read off /xsmn/thu-N and /xsmt/thu-N. It moves about once a
 * decade; when a province is added or changes day, this table is the edit.
 *
 * Miền Bắc is deliberately absent — it draws once a day for the whole region on
 * a different prize structure with five-digit tickets, so it would need its own
 * parser and its own rules rather than another row here.
 */

/** The two regions this tool covers. Both share one prize structure. */
export type Region = "mn" | "mt";

export interface Province {
	/** The path segment on xskt.com.vn, e.g. "xshg" in /xshg/ngay-15-8-2026. */
	slug: string;
	name: string;
	region: Region;
	/**
	 * The weekdays it draws on, as `Date.getDay()` — 0 is Sunday.
	 *
	 * Read in the browser's own timezone, which is the only reading that makes
	 * sense: a draw is a local calendar day, and every user of this tool is in
	 * the timezone the draws happen in.
	 */
	days: readonly number[];
}

export const REGION_NAMES: Record<Region, string> = {
	mn: "Miền Nam",
	mt: "Miền Trung",
};

/** Vietnamese weekday names, indexed by `Date.getDay()`. */
export const WEEKDAYS = [
	"Chủ Nhật",
	"Thứ Hai",
	"Thứ Ba",
	"Thứ Tư",
	"Thứ Năm",
	"Thứ Sáu",
	"Thứ Bảy",
] as const;

/*
 * In the site's own order, which puts Hồ Chí Minh first and the rest
 * alphabetically — so the list in the popup reads the way the list on
 * xskt.com.vn does.
 */
export const PROVINCES: readonly Province[] = [
	// --- Miền Nam ---
	{ slug: "xshcm-xstp", name: "Hồ Chí Minh", region: "mn", days: [1, 6] },
	{ slug: "xsag", name: "An Giang", region: "mn", days: [4] },
	{ slug: "xscm", name: "Cà Mau", region: "mn", days: [1] },
	{ slug: "xsct", name: "Cần Thơ", region: "mn", days: [3] },
	{ slug: "xsld-xsdl", name: "Đà Lạt – Lâm Đồng", region: "mn", days: [0] },
	{ slug: "xsdn", name: "Đồng Nai", region: "mn", days: [3] },
	{ slug: "xsdt", name: "Đồng Tháp", region: "mn", days: [1] },
	{ slug: "xstg", name: "Tiền Giang", region: "mn", days: [0] },
	{ slug: "xstn", name: "Tây Ninh", region: "mn", days: [4] },
	{ slug: "xsvl", name: "Vĩnh Long", region: "mn", days: [5] },
	{ slug: "xsbd", name: "Bình Dương", region: "mn", days: [5] },
	{ slug: "xsbl", name: "Bạc Liêu", region: "mn", days: [2] },
	{ slug: "xsbp", name: "Bình Phước", region: "mn", days: [6] },
	{ slug: "xsbt", name: "Bến Tre", region: "mn", days: [2] },
	{ slug: "xsbth", name: "Bình Thuận", region: "mn", days: [4] },
	{ slug: "xshg", name: "Hậu Giang", region: "mn", days: [6] },
	{ slug: "xskg", name: "Kiên Giang", region: "mn", days: [0] },
	{ slug: "xsla", name: "Long An", region: "mn", days: [6] },
	{ slug: "xsst", name: "Sóc Trăng", region: "mn", days: [3] },
	{ slug: "xstv", name: "Trà Vinh", region: "mn", days: [5] },
	{ slug: "xsvt", name: "Vũng Tàu", region: "mn", days: [2] },

	// --- Miền Trung ---
	{ slug: "xsbdi", name: "Bình Định", region: "mt", days: [4] },
	{ slug: "xsdlk", name: "Đắk Lắk", region: "mt", days: [2] },
	{ slug: "xsdng-xsdna", name: "Đà Nẵng", region: "mt", days: [3, 6] },
	{ slug: "xsdno", name: "Đắk Nông", region: "mt", days: [6] },
	{ slug: "xsgl", name: "Gia Lai", region: "mt", days: [5] },
	{ slug: "xskh", name: "Khánh Hòa", region: "mt", days: [3, 0] },
	{ slug: "xskt", name: "Kon Tum", region: "mt", days: [0] },
	{ slug: "xsnt", name: "Ninh Thuận", region: "mt", days: [5] },
	{ slug: "xspy", name: "Phú Yên", region: "mt", days: [1] },
	{ slug: "xsqb", name: "Quảng Bình", region: "mt", days: [4] },
	{ slug: "xsqng", name: "Quảng Ngãi", region: "mt", days: [6] },
	{ slug: "xsqnm-xsqna", name: "Quảng Nam", region: "mt", days: [2] },
	{ slug: "xsqt", name: "Quảng Trị", region: "mt", days: [4] },
	{ slug: "xstth", name: "Thành phố Huế", region: "mt", days: [1, 0] },
];

export function getProvince(slug: string): Province | undefined {
	return PROVINCES.find((province) => province.slug === slug);
}

export function drawsOn(province: Province, date: Date): boolean {
	return province.days.includes(date.getDay());
}

/** "Thứ Bảy", or "Thứ Hai và Thứ Bảy" for a province that draws twice. */
export function drawDayNames(province: Province): string {
	const names = province.days.map((day) => WEEKDAYS[day] ?? "");
	return names.length > 1 ? names.join(" và ") : (names[0] ?? "");
}

/**
 * The province's most recent draw day on or before `from`.
 *
 * A province draws at least once a week, so this always lands inside seven
 * steps; the bound is there so a province row with no days at all can't spin.
 */
export function lastDrawOnOrBefore(province: Province, from: Date): Date {
	const day = new Date(from);
	for (let step = 0; step < 7; step++) {
		if (drawsOn(province, day)) return day;
		day.setDate(day.getDate() - 1);
	}
	return from;
}
