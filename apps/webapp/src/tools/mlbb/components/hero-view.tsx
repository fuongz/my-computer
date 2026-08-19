import {
	CheckmarkCircle02Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useMemo, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { heroes, skinsByHero } from "#/tools/mlbb/catalogue.ts";
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
import { LANE_ICON, LANE_VI, ROLE_ICON, ROLE_VI } from "#/tools/mlbb/labels.ts";
import { useCollection } from "#/tools/mlbb/store.ts";
import { type Hero, LANES, ROLES } from "#/tools/mlbb/types.ts";

/** Reads its own ownership so a toggle repaints one tile, not all 133. */
const HeroTile = memo(function HeroTile({ hero }: { hero: Hero }) {
	const owned = useCollection((s) => !!s.heroes[hero.id]);
	const toggle = useCollection((s) => s.toggleHero);
	const skinCount = skinsByHero.get(hero.name)?.length ?? 0;

	return (
		<CollectionTile
			id={hero.id}
			name={hero.name}
			// A slash between the two roles, a comma before the count. One middot doing
			// both jobs made "Đấu Sĩ · Sát Thủ · 11 trang phục" read as three roles.
			subtitle={`${hero.roles.map((role) => ROLE_VI[role]).join("/")}, ${skinCount} trang phục`}
			splash={hero.splash}
			owned={owned}
			onToggle={() => toggle(hero.id)}
		/>
	);
});

// The membership of each facet never changes, so it is computed once here; only the
// owned tally moves, and that is folded in per render below.
const BY_ROLE = ROLES.map((role) => ({
	role,
	list: heroes.filter((hero) => hero.roles.includes(role)),
}));
const BY_LANE = LANES.map((lane) => ({
	lane,
	list: heroes.filter((hero) => hero.lanes.includes(lane)),
}));

export function HeroView() {
	const ownedHeroes = useCollection((s) => s.heroes);
	const setHeroes = useCollection((s) => s.setHeroes);
	const hydrated = useCollection((s) => s.hydrated);

	const [query, setQuery] = useState("");
	const [ownership, setOwnership] = useState<Ownership>("all");
	const [roles, setRoles] = useState<ReadonlySet<string>>(new Set());
	const [lanes, setLanes] = useState<ReadonlySet<string>>(new Set());

	// Counted over the whole catalogue, not over what the other filters are showing:
	// a chip that says "Đấu Sĩ 12/44" should mean the same thing whichever lane is
	// also selected, otherwise the numbers move while you are reading them.
	const roleOptions = useMemo(
		() =>
			BY_ROLE.map(({ role, list }) => ({
				value: role,
				label: ROLE_VI[role],
				icon: ROLE_ICON[role],
				count: list.length,
				owned: hydrated
					? list.filter((hero) => ownedHeroes[hero.id]).length
					: undefined,
			})),
		[ownedHeroes, hydrated],
	);

	const laneOptions = useMemo(
		() =>
			BY_LANE.map(({ lane, list }) => ({
				value: lane,
				label: LANE_VI[lane],
				icon: LANE_ICON[lane],
				count: list.length,
				owned: hydrated
					? list.filter((hero) => ownedHeroes[hero.id]).length
					: undefined,
			})),
		[ownedHeroes, hydrated],
	);

	const filtered = useMemo(() => {
		const needle = normalize(query);
		return heroes.filter((hero) => {
			if (!matchesOwnership(ownership, !!ownedHeroes[hero.id])) return false;
			if (roles.size && !hero.roles.some((role) => roles.has(role)))
				return false;
			if (lanes.size && !hero.lanes.some((lane) => lanes.has(lane)))
				return false;
			if (!needle) return true;
			return (
				normalize(hero.name).includes(needle) ||
				normalize(hero.title).includes(needle)
			);
		});
	}, [query, ownership, roles, lanes, ownedHeroes]);

	const ownedShown = filtered.filter((hero) => ownedHeroes[hero.id]).length;
	const ids = filtered.map((hero) => hero.id);

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
						placeholder="Tìm tướng theo tên hoặc danh hiệu…"
						aria-label="Tìm tướng"
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
				label="Vai trò"
				options={roleOptions}
				selected={roles}
				onChange={setRoles}
			/>
			<ChipGroup
				label="Đường"
				options={laneOptions}
				selected={lanes}
				onChange={setLanes}
			/>

			<div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
				<span className="tabular-nums">Đang hiện {filtered.length} tướng</span>
				<span className="flex items-center gap-1 tabular-nums">
					<HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} />
					{ownedShown} đã có
				</span>
				<div className="ml-auto flex gap-2">
					<Button
						variant="outline"
						size="xs"
						disabled={filtered.length === 0}
						onClick={() => setHeroes(ids, true)}
					>
						Đánh dấu đang hiện
					</Button>
					<Button
						variant="ghost"
						size="xs"
						disabled={ownedShown === 0}
						onClick={() => setHeroes(ids, false)}
					>
						Bỏ đánh dấu
					</Button>
				</div>
			</div>

			{filtered.length === 0 ? (
				<EmptyState>Không có tướng nào khớp bộ lọc.</EmptyState>
			) : (
				<Grid>
					{filtered.map((hero) => (
						<HeroTile key={hero.id} hero={hero} />
					))}
				</Grid>
			)}
		</div>
	);
}
