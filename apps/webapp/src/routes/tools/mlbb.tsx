import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "#/components/shared/app-shell.tsx";
import { heroes, meta, skins } from "#/tools/mlbb/catalogue.ts";
import { BackupControls } from "#/tools/mlbb/components/backup-controls.tsx";
import { CollectionProgress } from "#/tools/mlbb/components/collection-progress.tsx";
import { HeroView } from "#/tools/mlbb/components/hero-view.tsx";
import { MissingHeroes } from "#/tools/mlbb/components/missing-heroes.tsx";
import { Segmented } from "#/tools/mlbb/components/segmented.tsx";
import { SkinView } from "#/tools/mlbb/components/skin-view.tsx";
import { hydrateCollection, useCollection } from "#/tools/mlbb/store.ts";

export const Route = createFileRoute("/tools/mlbb")({
	component: MlbbCollection,
});

function MlbbCollection() {
	const [tab, setTab] = useState<"heroes" | "skins">("heroes");

	// The collection lives in localStorage, which the server cannot read — so the
	// store starts empty (matching the SSR'd HTML) and fills in here, one tick after
	// hydration. Doing it any earlier is what makes React tear the tree down.
	useEffect(() => {
		void hydrateCollection();
	}, []);

	const hydrated = useCollection((s) => s.hydrated);
	const heroesOwned = useCollection((s) => Object.keys(s.heroes).length);
	const skinsOwned = useCollection((s) => Object.keys(s.skins).length);

	// Only the total until the store has read localStorage — `Tướng (0/133)` for a
	// frame is a claim about the account, the same reason the meters show skeletons.
	const tabs = [
		{
			value: "heroes" as const,
			label: hydrated
				? `Tướng (${heroesOwned}/${heroes.length})`
				: `Tướng (${heroes.length})`,
		},
		{
			value: "skins" as const,
			label: hydrated
				? `Trang phục (${skinsOwned}/${skins.length})`
				: `Trang phục (${skins.length})`,
		},
	];

	return (
		<AppShell
			title="Bộ sưu tập Mobile Legends"
			description="Bấm vào một thẻ để đánh dấu bạn đã có."
			actions={<BackupControls />}
		>
			<CollectionProgress
				hydrated={hydrated}
				heroesOwned={heroesOwned}
				heroesTotal={heroes.length}
				skinsOwned={skinsOwned}
				skinsTotal={skins.length}
			/>

			<MissingHeroes />

			<Segmented
				aria-label="Chọn danh mục"
				options={tabs}
				value={tab}
				onChange={setTab}
			/>

			{tab === "heroes" ? <HeroView /> : <SkinView />}

			<p className="mt-2 text-xs text-muted-foreground">
				Dữ liệu tướng và trang phục lấy từ{" "}
				<a
					href={meta.source}
					target="_blank"
					rel="noreferrer"
					className="underline underline-offset-2 hover:text-foreground"
				>
					Mobile Legends Wiki
				</a>
				, cập nhật ngày {meta.syncedAt.slice(0, 10)}. Đánh dấu của bạn chỉ lưu
				trong trình duyệt này — nhớ xuất tệp trước khi xoá dữ liệu duyệt web.
			</p>
		</AppShell>
	);
}
