import {
	BowArrowIcon,
	ChartUpIcon,
	Coins01Icon,
	CompassIcon,
	HeartAddIcon,
	Knife02Icon,
	MagicWand01Icon,
	Shield01Icon,
	SwordIcon,
	Target02Icon,
	TreeIcon,
} from "@hugeicons/core-free-icons";
import type { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import type { Availability, Lane, Role, Tier } from "./types.ts";

type Icon = ComponentProps<typeof HugeiconsIcon>["icon"];

/**
 * Vietnamese for the catalogue's fixed vocabularies — the words the game client
 * itself uses, so a filter here reads the same as the filter in the game.
 *
 * Hero names, skin names, tiers and tags are deliberately absent: those are proper
 * nouns the wiki only has in English, and a translation invented here would be a
 * name no player could search for.
 */

export const ROLE_VI: Record<Role, string> = {
	Tank: "Đỡ Đòn",
	Fighter: "Đấu Sĩ",
	Assassin: "Sát Thủ",
	Mage: "Pháp Sư",
	Marksman: "Xạ Thủ",
	Support: "Hỗ Trợ",
};

export const LANE_VI: Record<Lane, string> = {
	"EXP Lane": "Đường Kinh Nghiệm",
	"Gold Lane": "Đường Vàng",
	"Mid Lane": "Đường Giữa",
	Jungle: "Đi Rừng",
	// The game calls this lane "Hỗ Trợ" too, which collides with the Support role —
	// so use what players actually say out loud instead of reusing the role's word.
	Roaming: "Đi Roam",
};

/**
 * A glyph per role and per lane, so a filter row is scannable before it is read.
 *
 * Each one is the job, not the hero: a shield for the one who absorbs, a bow for the
 * one who shoots from range, coins for the lane you farm. The lane icons deliberately
 * avoid reusing a role's glyph — a crosshair for Mid beside a bow for Marksman would
 * read as the same axis twice.
 */
export const ROLE_ICON: Record<Role, Icon> = {
	Tank: Shield01Icon,
	Fighter: SwordIcon,
	Assassin: Knife02Icon,
	Mage: MagicWand01Icon,
	Marksman: BowArrowIcon,
	Support: HeartAddIcon,
};

export const LANE_ICON: Record<Lane, Icon> = {
	"EXP Lane": ChartUpIcon,
	"Gold Lane": Coins01Icon,
	"Mid Lane": Target02Icon,
	Jungle: TreeIcon,
	Roaming: CompassIcon,
};

export const AVAILABILITY_VI: Record<Availability, string> = {
	Available: "Đang bán",
	Limited: "Giới hạn",
	Upcoming: "Sắp ra",
};

/**
 * Rarity, from the game's own scale. Kept in English like the tags — but each gets a
 * colour, because rarity is the one axis on this page where colour carries meaning
 * rather than decorates. Neutral for the default skin, which has no rarity at all.
 *
 * Ink and ring only. The badge sits on splash art that is bright in one corner and
 * black in the next, so the surface underneath it has to be the page's own opaque
 * background — a tinted translucent chip is legible over roughly half the catalogue.
 */
export const TIER_STYLE: Record<Tier | "", string> = {
	"": "text-muted-foreground ring-border",
	Common: "text-slate-600 ring-slate-500/30 dark:text-slate-300",
	Exceptional: "text-sky-700 ring-sky-500/40 dark:text-sky-300",
	Deluxe: "text-violet-700 ring-violet-500/40 dark:text-violet-300",
	Exquisite: "text-fuchsia-700 ring-fuchsia-500/40 dark:text-fuchsia-300",
	Grand: "text-amber-700 ring-amber-500/50 dark:text-amber-300",
	Supreme: "text-rose-700 ring-rose-500/40 dark:text-rose-300",
};

/** What a hero's default skin is called in the filter, where `""` would read as a bug. */
export const NO_TIER_LABEL = "Mặc định";

export const CURRENCY_VI = {
	dm: "Kim cương",
	bp: "Điểm chiến đấu",
	ticket: "Vé",
	fragment: "Mảnh",
	lg: "Đá may mắn",
} as const;
