import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo } from "react";
import { heroes, skins } from "#/tools/mlbb/catalogue.ts";
import { artwork } from "#/tools/mlbb/images.ts";
import { ROLE_VI } from "#/tools/mlbb/labels.ts";
import { useCollection } from "#/tools/mlbb/store.ts";

/**
 * Heroes you own a skin for but have not unlocked.
 *
 * This is the one thing the two independent sets in the store can say that neither
 * says alone, and it is worth saying: an owned skin you cannot play is a hero worth
 * buying next, and the game's own collection screen will not tell you which.
 *
 * Hidden entirely when the answer is "none" — a panel that renders an empty state on
 * every fresh visit is a panel that trains you to stop reading it.
 */
export function MissingHeroes() {
	const ownedHeroes = useCollection((s) => s.heroes);
	const ownedSkins = useCollection((s) => s.skins);
	const toggleHero = useCollection((s) => s.toggleHero);

	const gap = useMemo(() => {
		const skinCount = new Map<string, number>();
		for (const skin of skins) {
			if (ownedSkins[skin.id]) {
				skinCount.set(skin.hero, (skinCount.get(skin.hero) ?? 0) + 1);
			}
		}
		return heroes
			.filter((hero) => skinCount.has(hero.name) && !ownedHeroes[hero.id])
			.map((hero) => ({ hero, skins: skinCount.get(hero.name) ?? 0 }));
	}, [ownedHeroes, ownedSkins]);

	if (gap.length === 0) return null;

	return (
		<section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
			<div className="mb-3 flex items-start gap-2">
				<HugeiconsIcon
					icon={Alert02Icon}
					size={16}
					className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
				/>
				<div className="min-w-0">
					<h2 className="text-sm font-medium">
						{gap.length} tướng có trang phục nhưng bạn chưa sở hữu
					</h2>
					<p className="text-xs text-muted-foreground">
						Bấm vào một tướng để đánh dấu là đã có.
					</p>
				</div>
			</div>

			<ul className="flex flex-wrap gap-2">
				{gap.map(({ hero, skins: count }) => (
					<li key={hero.id}>
						<button
							type="button"
							onClick={() => toggleHero(hero.id)}
							className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pr-3 pl-1 text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
						>
							<img
								src={artwork(hero.id)}
								alt=""
								loading="lazy"
								decoding="async"
								className="size-6 rounded-full object-cover object-top"
							/>
							<span className="font-medium">{hero.name}</span>
							<span className="text-muted-foreground">
								{hero.roles.map((role) => ROLE_VI[role]).join("/")}, có {count}{" "}
								trang phục
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
