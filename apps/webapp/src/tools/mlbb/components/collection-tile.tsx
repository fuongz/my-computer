import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";
import { artwork } from "#/tools/mlbb/images.ts";

/**
 * One hero or one skin, as a card you press to say you own it.
 *
 * Unowned is drawn desaturated and dimmed — the same shorthand the game itself uses,
 * so the grid reads at a glance without anybody learning a new convention. Owned adds
 * a ring and a tick, because desaturation alone is invisible on a greyscale skin and
 * to anyone who cannot separate the two by colour.
 */
export function CollectionTile({
	id,
	name,
	subtitle,
	splash,
	badge,
	owned,
	onToggle,
}: {
	/** `Hero.id` / `Skin.id` — also the artwork's filename. */
	id: string;
	name: string;
	subtitle: string;
	/**
	 * The row's splash-art path, or null for the 37 skins the wiki has none for.
	 * The image is loaded by id either way; this only says which of the two kinds of
	 * picture arrived, so a square icon is not cropped like full-bleed art.
	 */
	splash: string | null;
	badge?: ReactNode;
	owned: boolean;
	onToggle: () => void;
}) {
	const usingIcon = splash === null;

	return (
		<button
			type="button"
			// The filter chips are `aria-pressed` toggles too, so the tiles carry a slot
			// of their own — otherwise every "count the tiles" selector silently counts
			// the filters as well, which is exactly the bug `preview:mlbb` first found.
			data-slot="collection-tile"
			onClick={onToggle}
			aria-pressed={owned}
			aria-label={`${name} — ${subtitle}. ${owned ? "Đã có" : "Chưa có"}.`}
			// Parentheses, not a separator glyph: the tooltip exists for names the card
			// truncates, and "Campus Youth (Fanny)" survives being read aloud in a way
			// that a middot between two nouns does not.
			title={`${name} (${subtitle})`}
			className={cn(
				"group relative aspect-3/4 overflow-hidden rounded-xl bg-muted text-left transition-all",
				"outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
				owned
					? "ring-2 ring-primary"
					: "ring-1 ring-border hover:ring-2 hover:ring-primary/40",
			)}
		>
			<img
				src={artwork(id)}
				alt=""
				loading="lazy"
				decoding="async"
				className={cn(
					"size-full transition-[filter,opacity,transform] duration-200",
					usingIcon ? "scale-90 object-contain" : "object-cover object-top",
					owned
						? "opacity-100"
						: "opacity-55 grayscale group-hover:opacity-90 group-hover:grayscale-0",
				)}
			/>

			{/* The scrim, not a solid bar: the art keeps going behind the name. */}
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2.5 pt-8 pb-2">
				<p className="truncate text-[13px] font-medium text-white">{name}</p>
				<p className="truncate text-[11px] text-white/70">{subtitle}</p>
			</div>

			{badge ? <div className="absolute top-2 left-2">{badge}</div> : null}

			{owned ? (
				<span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
					<HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
				</span>
			) : null}
		</button>
	);
}
