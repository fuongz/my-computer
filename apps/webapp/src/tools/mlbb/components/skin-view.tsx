import {
	CheckmarkCircle02Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useMemo, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";
import { skins, tags } from "#/tools/mlbb/catalogue.ts";
import { ChipGroup } from "#/tools/mlbb/components/chip-group.tsx";
import { CollectionTile } from "#/tools/mlbb/components/collection-tile.tsx";
import { Segmented } from "#/tools/mlbb/components/segmented.tsx";
import {
	EmptyState,
	Grid,
	matchesOwnership,
	normalize,
	OWNERSHIP_OPTIONS,
	type Ownership,
} from "#/tools/mlbb/components/shared.tsx";
import {
	AVAILABILITY_VI,
	NO_TIER_LABEL,
	TIER_STYLE,
} from "#/tools/mlbb/labels.ts";
import { useCollection } from "#/tools/mlbb/store.ts";
import { AVAILABILITY, type Skin, TIERS } from "#/tools/mlbb/types.ts";

/** Reads its own ownership so a toggle repaints one tile, not all 1007. */
const SkinTile = memo(function SkinTile({ skin }: { skin: Skin }) {
	const owned = useCollection((s) => !!s.skins[skin.id]);
	const toggle = useCollection((s) => s.toggleSkin);

	return (
		<CollectionTile
			id={skin.id}
			name={skin.name}
			subtitle={skin.hero}
			splash={skin.splash}
			owned={owned}
			onToggle={() => toggle(skin.id)}
			badge={
				skin.tier ? (
					<span
						className={cn(
							"rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium ring-1 backdrop-blur-sm",
							TIER_STYLE[skin.tier],
						)}
					>
						{skin.tier}
					</span>
				) : null
			}
		/>
	);
});

// Membership per facet, computed once — only the owned tally moves per render.
const BY_TIER = [
	{ value: "", label: NO_TIER_LABEL },
	...TIERS.map((tier) => ({ value: tier as string, label: tier as string })),
].map((option) => ({
	...option,
	list: skins.filter((skin) => skin.tier === option.value),
}));

const BY_AVAILABILITY = AVAILABILITY.map((value) => ({
	value: value as string,
	label: AVAILABILITY_VI[value],
	list: skins.filter((skin) => skin.availability === value),
}));

const BY_TAG = new Map(
	tags.map(({ tag }) => [tag, skins.filter((skin) => skin.tag === tag)]),
);

// There are over a hundred tags and the tail is single-season one-offs. The chip row
// shows the ones worth a click; the rest stay reachable through the dropdown beside
// it, which promotes whatever you pick into the row so it can be un-picked there.
const TOP_TAGS = 12;

export function SkinView() {
	const ownedSkins = useCollection((s) => s.skins);
	const setSkins = useCollection((s) => s.setSkins);
	const hydrated = useCollection((s) => s.hydrated);

	const [query, setQuery] = useState("");
	const [ownership, setOwnership] = useState<Ownership>("all");
	const [tiers, setTiers] = useState<ReadonlySet<string>>(new Set());
	const [availability, setAvailability] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(
		new Set(),
	);

	// Counted over the whole catalogue, not over what the other filters are showing:
	// a chip that says "StarLight 12/108" should mean the same thing whichever tier
	// is also selected, otherwise the numbers move while you are reading them.
	const ownedIn = useMemo(
		() => (list: typeof skins) =>
			hydrated ? list.filter((skin) => ownedSkins[skin.id]).length : undefined,
		[ownedSkins, hydrated],
	);

	const tierOptions = useMemo(
		() =>
			BY_TIER.map(({ value, label, list }) => ({
				value,
				label,
				count: list.length,
				owned: ownedIn(list),
			})),
		[ownedIn],
	);

	const availabilityOptions = useMemo(
		() =>
			BY_AVAILABILITY.map(({ value, label, list }) => ({
				value,
				label,
				count: list.length,
				owned: ownedIn(list),
			})),
		[ownedIn],
	);

	const tagOptions = useMemo(() => {
		const shown = new Set([
			...tags.slice(0, TOP_TAGS).map((entry) => entry.tag),
			...selectedTags,
		]);
		return tags
			.filter((entry) => shown.has(entry.tag))
			.map((entry) => ({
				value: entry.tag,
				label: entry.tag,
				count: entry.count,
				owned: ownedIn(BY_TAG.get(entry.tag) ?? []),
			}));
	}, [selectedTags, ownedIn]);

	const filtered = useMemo(() => {
		const needle = normalize(query);
		return skins.filter((skin) => {
			if (!matchesOwnership(ownership, !!ownedSkins[skin.id])) return false;
			if (tiers.size && !tiers.has(skin.tier)) return false;
			if (availability.size && !availability.has(skin.availability))
				return false;
			if (selectedTags.size && !selectedTags.has(skin.tag)) return false;
			if (!needle) return true;
			return (
				normalize(skin.name).includes(needle) ||
				normalize(skin.hero).includes(needle)
			);
		});
	}, [query, ownership, tiers, availability, selectedTags, ownedSkins]);

	const ownedShown = filtered.filter((skin) => ownedSkins[skin.id]).length;
	const ids = filtered.map((skin) => skin.id);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-56 flex-1">
					<HugeiconsIcon
						icon={Search01Icon}
						size={14}
						className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Tìm trang phục hoặc tên tướng…"
						aria-label="Tìm trang phục"
						className="pl-7"
					/>
				</div>
				<Segmented
					aria-label="Lọc theo tình trạng sở hữu"
					options={OWNERSHIP_OPTIONS}
					value={ownership}
					onChange={setOwnership}
				/>
			</div>

			<ChipGroup
				label="Bậc"
				options={tierOptions}
				selected={tiers}
				onChange={setTiers}
			/>
			<ChipGroup
				label="Trạng thái"
				options={availabilityOptions}
				selected={availability}
				onChange={setAvailability}
			/>

			<div className="flex flex-wrap items-center gap-2">
				<ChipGroup
					label="Bộ sưu tập"
					options={tagOptions}
					selected={selectedTags}
					onChange={setSelectedTags}
				/>
				<select
					value=""
					aria-label="Chọn bộ sưu tập khác"
					onChange={(event) => {
						const tag = event.target.value;
						if (tag) setSelectedTags(new Set([...selectedTags, tag]));
					}}
					className="h-7 rounded-full border border-border bg-background px-2 text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
				>
					<option value="">Bộ sưu tập khác…</option>
					{tags.map((entry) => (
						<option key={entry.tag} value={entry.tag}>
							{entry.tag} ({entry.count})
						</option>
					))}
				</select>
			</div>

			<div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
				<span className="tabular-nums">
					Đang hiện {filtered.length} trang phục
				</span>
				<span className="flex items-center gap-1 tabular-nums">
					<HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} />
					{ownedShown} đã có
				</span>
				<div className="ml-auto flex gap-2">
					<Button
						variant="outline"
						size="xs"
						disabled={filtered.length === 0}
						onClick={() => setSkins(ids, true)}
					>
						Đánh dấu đang hiện
					</Button>
					<Button
						variant="ghost"
						size="xs"
						disabled={ownedShown === 0}
						onClick={() => setSkins(ids, false)}
					>
						Bỏ đánh dấu
					</Button>
				</div>
			</div>

			{filtered.length === 0 ? (
				<EmptyState>Không có trang phục nào khớp bộ lọc.</EmptyState>
			) : (
				<Grid>
					{filtered.map((skin) => (
						<SkinTile key={skin.id} skin={skin} />
					))}
				</Grid>
			)}
		</div>
	);
}
