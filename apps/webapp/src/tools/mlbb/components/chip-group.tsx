import type { HugeiconsIcon as HugeiconsIconType } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { cn } from "#/lib/utils.ts";

export interface ChipOption {
	value: string;
	label: string;
	/** How many rows carry this value, shown as a badge after the label. */
	count?: number;
	/**
	 * How many of those you own, rendered as `owned/count`.
	 *
	 * Left undefined until the store has read localStorage — a badge reading `0/25`
	 * for a frame is a claim about the account, and the whole point of the number is
	 * that it is true.
	 */
	owned?: number;
	/** Optional glyph for the thing being filtered on — a role, a lane. */
	icon?: ComponentProps<typeof HugeiconsIconType>["icon"];
}

/**
 * A row of toggles over one filter axis. Nothing selected means no filtering — which
 * is why there is no "Tất cả" chip: it would be a second way to say the same thing,
 * and the two would eventually disagree.
 *
 * Multi-select, because "show me Đỡ Đòn and Đấu Sĩ" is a question people actually
 * have and a radio group cannot answer it.
 *
 * The count sits in its own badge rather than running on after the label. Two numbers
 * in a row ("Đấu Sĩ 44" next to "Sát Thủ 29") read as one string when they share a
 * background; giving each its own well is what separates the label from the tally.
 */
export function ChipGroup({
	label,
	options,
	selected,
	onChange,
}: {
	label: string;
	options: ChipOption[];
	selected: ReadonlySet<string>;
	onChange: (next: Set<string>) => void;
}) {
	if (options.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="mr-1 text-xs font-medium text-muted-foreground">
				{label}
			</span>
			{options.map((option) => {
				const active = selected.has(option.value);
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						onClick={() => {
							const next = new Set(selected);
							if (!next.delete(option.value)) next.add(option.value);
							onChange(next);
						}}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5 text-xs transition-colors outline-none",
							"focus-visible:ring-3 focus-visible:ring-ring/40",
							active
								? "border-transparent bg-primary text-primary-foreground"
								: "border-border bg-background text-foreground hover:bg-muted",
						)}
					>
						{option.icon ? (
							<HugeiconsIcon
								icon={option.icon}
								size={13}
								className={active ? "opacity-80" : "text-muted-foreground"}
							/>
						) : null}
						{option.label}
						{option.count === undefined ? null : (
							<span
								className={cn(
									"rounded-md px-1.5 py-px text-[11px] tabular-nums",
									active
										? "bg-primary-foreground/20"
										: "bg-muted text-muted-foreground",
								)}
							>
								{option.owned === undefined
									? option.count
									: `${option.owned}/${option.count}`}
							</span>
						)}
					</button>
				);
			})}
			{selected.size > 0 ? (
				<button
					type="button"
					onClick={() => onChange(new Set())}
					className="ml-0.5 rounded-full px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				>
					Bỏ lọc
				</button>
			) : null}
		</div>
	);
}
