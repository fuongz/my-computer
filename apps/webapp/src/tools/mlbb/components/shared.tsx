import type { ReactNode } from "react";

/** The three answers to "show me what?" — the same question on both tabs. */
export type Ownership = "all" | "owned" | "missing";

export const OWNERSHIP_OPTIONS: { value: Ownership; label: string }[] = [
	{ value: "all", label: "Tất cả" },
	{ value: "owned", label: "Đã có" },
	{ value: "missing", label: "Chưa có" },
];

export function matchesOwnership(filter: Ownership, owned: boolean): boolean {
	return filter === "all" || (filter === "owned") === owned;
}

/**
 * Lowercase and strip Vietnamese diacritics, so `dau si` finds `Đấu Sĩ` and `layla`
 * finds `Layla`. Typing tones to search a list is a tax nobody should pay.
 *
 * `đ` is handled separately: it is a distinct letter, not `d` plus a mark, so NFD
 * leaves it alone.
 */
export function normalize(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/đ/g, "d");
}

export function Grid({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
			{children}
		</div>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
			{children}
		</p>
	);
}
