import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "#/components/ui/progress.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

function Meter({
	label,
	owned,
	total,
}: {
	label: string;
	owned: number;
	total: number;
}) {
	const percent = total === 0 ? 0 : Math.round((owned / total) * 100);
	return (
		<Progress value={percent}>
			<ProgressLabel>{label}</ProgressLabel>
			<ProgressValue
				render={
					<span className="ml-auto text-sm text-muted-foreground tabular-nums">
						{owned}/{total} ({percent}%)
					</span>
				}
			/>
		</Progress>
	);
}

/**
 * The two numbers the whole tool exists to produce.
 *
 * While the store is still reading localStorage these are skeletons rather than
 * zeroes — "0/1007" is a claim about the user's account, and showing it for a frame
 * before the real figure arrives is worse than showing nothing.
 */
export function CollectionProgress({
	hydrated,
	heroesOwned,
	heroesTotal,
	skinsOwned,
	skinsTotal,
}: {
	hydrated: boolean;
	heroesOwned: number;
	heroesTotal: number;
	skinsOwned: number;
	skinsTotal: number;
}) {
	if (!hydrated) {
		return (
			<div className="grid gap-4 sm:grid-cols-2">
				<Skeleton className="h-10 rounded-xl" />
				<Skeleton className="h-10 rounded-xl" />
			</div>
		);
	}

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<Meter label="Tướng" owned={heroesOwned} total={heroesTotal} />
			<Meter label="Trang phục" owned={skinsOwned} total={skinsTotal} />
		</div>
	);
}
