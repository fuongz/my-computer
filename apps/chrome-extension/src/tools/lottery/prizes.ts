/**
 * The prize table, and scoring one ticket against one draw.
 *
 * Pure, and deliberately the only place the rules are written down: everything
 * here was checked case by case against xskt.com.vn's own dò-vé-số page for the
 * Hồ Chí Minh draw of 15/08/2026, and those four cases are what the preview
 * script pins.
 *
 * Southern and central draws share one structure. A ticket is six digits, and
 * it takes a prize when its LAST n digits are one of that prize's numbers —
 * two digits for giải tám, three for giải bảy, and so on up to all six for the
 * đặc biệt. Two further prizes hang off the đặc biệt alone:
 *
 *   phụ đặc biệt   the last five digits match, the first one does not
 *   khuyến khích   exactly one of the last five digits is wrong
 *
 * Prizes stack. A ticket ending 8531 against that HCM draw takes giải sáu and
 * giải tám at once and pays 500,000 — which is what the site returns for it,
 * and why this sums rather than reporting the best one.
 */

/** The nine prizes a draw actually publishes, biggest first. */
export type PrizeCode =
	| "db"
	| "g1"
	| "g2"
	| "g3"
	| "g4"
	| "g5"
	| "g6"
	| "g7"
	| "g8";

/** Those nine, plus the two that are derived from the đặc biệt. */
export type HitCode = PrizeCode | "phu-db" | "kk";

/** Every ticket in these draws is six digits, zero-padded. */
export const TICKET_LENGTH = 6;

export interface PrizeTier {
	code: PrizeCode;
	/** As printed in the result table: "ĐB", "G1", … */
	label: string;
	name: string;
	amount: number;
}

/**
 * In the order the result is drawn: the đặc biệt at the top, giải tám at the
 * bottom. The province pages print it the other way up; this is the order the
 * site's own dò-vé-số table uses, and the one that puts the prize everyone
 * looks for first.
 */
export const PRIZE_TIERS: readonly PrizeTier[] = [
	{ code: "db", label: "ĐB", name: "Giải Đặc Biệt", amount: 2_000_000_000 },
	{ code: "g1", label: "G1", name: "Giải Nhất", amount: 30_000_000 },
	{ code: "g2", label: "G2", name: "Giải Nhì", amount: 15_000_000 },
	{ code: "g3", label: "G3", name: "Giải Ba", amount: 10_000_000 },
	{ code: "g4", label: "G4", name: "Giải Tư", amount: 3_000_000 },
	{ code: "g5", label: "G5", name: "Giải Năm", amount: 1_000_000 },
	{ code: "g6", label: "G6", name: "Giải Sáu", amount: 400_000 },
	{ code: "g7", label: "G7", name: "Giải Bảy", amount: 200_000 },
	{ code: "g8", label: "G8", name: "Giải Tám", amount: 100_000 },
];

const CONSOLATION = {
	"phu-db": { name: "Giải Phụ Đặc Biệt", amount: 50_000_000 },
	kk: { name: "Giải Khuyến Khích", amount: 6_000_000 },
} as const;

export function tierFor(code: PrizeCode): PrizeTier | undefined {
	return PRIZE_TIERS.find((tier) => tier.code === code);
}

/** One prize a ticket took, and the drawn number that gave it. */
export interface Hit {
	code: HitCode;
	name: string;
	amount: number;
	/** The number as drawn — the six digits of the đặc biệt for the two below. */
	number: string;
}

export interface Score {
	hits: Hit[];
	total: number;
	/**
	 * How the ticket stands against the đặc biệt, for the near-miss line and for
	 * marking that number in the table as almost-yours.
	 *
	 * "none" also covers a ticket two or more digits away, which is every ticket
	 * that isn't close at all.
	 */
	special: "won" | "phu-db" | "kk" | "none";
}

/** The prizes a draw published, as the parser hands them over. */
export type DrawnNumbers = Partial<Record<PrizeCode, readonly string[]>>;

/**
 * Score one ticket. `ticket` is expected to be {@link TICKET_LENGTH} digits;
 * anything else scores nothing rather than throwing, because the panel would
 * rather say so in its own words than catch an exception.
 */
export function score(ticket: string, drawn: DrawnNumbers): Score {
	const hits: Hit[] = [];
	if (!isTicket(ticket)) return { hits, total: 0, special: "none" };

	for (const tier of PRIZE_TIERS) {
		for (const number of drawn[tier.code] ?? []) {
			// A number longer than the ticket can never be its tail, and would
			// otherwise pass endsWith() on a malformed row.
			if (number.length > ticket.length) continue;
			if (!ticket.endsWith(number)) continue;
			hits.push({
				code: tier.code,
				name: tier.name,
				amount: tier.amount,
				number,
			});
		}
	}

	const special = compareSpecial(ticket, drawn.db?.[0]);
	if (special === "phu-db" || special === "kk") {
		const consolation = CONSOLATION[special];
		hits.push({
			code: special,
			name: consolation.name,
			amount: consolation.amount,
			// The đặc biệt itself: it is the number these two are measured from,
			// and the one the result view marks as the near miss.
			number: drawn.db?.[0] ?? "",
		});
	}

	hits.sort((a, b) => b.amount - a.amount);
	return {
		hits,
		total: hits.reduce((sum, hit) => sum + hit.amount, 0),
		special,
	};
}

/**
 * Which of the đặc biệt's three outcomes a ticket lands on.
 *
 * The two consolation prizes are the same test read at different places: count
 * the digits that differ, and if there is exactly one, the prize depends on
 * whether it is the leading digit or one of the other five.
 */
function compareSpecial(ticket: string, db: string | undefined): Score["special"] {
	if (!db || !isTicket(db)) return "none";

	const wrong: number[] = [];
	for (let index = 0; index < TICKET_LENGTH; index++) {
		if (ticket[index] !== db[index]) wrong.push(index);
	}

	if (wrong.length === 0) return "won";
	if (wrong.length > 1) return "none";
	return wrong[0] === 0 ? "phu-db" : "kk";
}

export function isTicket(value: string): boolean {
	return new RegExp(`^\\d{${TICKET_LENGTH}}$`).test(value);
}

/**
 * How many trailing digits of the ticket a prize's numbers cover — what the
 * result view underlines on the ticket itself.
 */
export function matchedLength(hits: readonly Hit[]): number {
	let longest = 0;
	for (const hit of hits) {
		// The consolation prizes are not a tail match; nothing to underline.
		if (hit.code === "phu-db" || hit.code === "kk") continue;
		longest = Math.max(longest, hit.number.length);
	}
	return longest;
}

const DONG = new Intl.NumberFormat("vi-VN");

/** "100.000" — the amount alone; the panel supplies the ₫. */
export function formatDong(amount: number): string {
	return DONG.format(amount);
}
