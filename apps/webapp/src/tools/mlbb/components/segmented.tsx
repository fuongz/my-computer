import { useId } from "react";
import { cn } from "#/lib/utils.ts";

/**
 * A small exclusive switch — one of N, always exactly one. Used where a chip row
 * would be wrong because the options are a single question, not a set of filters.
 *
 * Built on real radio inputs inside a `fieldset` rather than buttons wearing
 * `role="radio"`: arrow-key navigation, the roving tab stop and the group's accessible
 * name all come from the platform that way, and none of them are things worth
 * reimplementing to save a wrapper.
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	"aria-label": ariaLabel,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (next: T) => void;
	"aria-label": string;
}) {
	const name = useId();

	return (
		// `w-fit`, not just `inline-flex`: a flex column stretches its children, and
		// without it the control spans the whole page wherever it is not in a row.
		<fieldset className="inline-flex w-fit shrink-0 rounded-lg bg-muted p-0.5">
			<legend className="sr-only">{ariaLabel}</legend>
			{options.map((option) => (
				<label
					key={option.value}
					className={cn(
						"cursor-pointer rounded-[calc(var(--radius-lg)-2px)] px-3 py-1 text-xs font-medium transition-colors",
						"has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
						value === option.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					<input
						type="radio"
						name={name}
						value={option.value}
						checked={value === option.value}
						onChange={() => onChange(option.value)}
						className="sr-only"
					/>
					{option.label}
				</label>
			))}
		</fieldset>
	);
}
