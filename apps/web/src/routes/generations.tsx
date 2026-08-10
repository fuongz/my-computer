import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "#/components/shared/app-shell";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button, buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { Spinner } from "#/components/ui/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { getSession } from "#/server/auth";
import type { GenerationSummary } from "#/server/core/generations";
import {
	getGenerations,
	recheckGeneration,
	removeGeneration,
} from "#/server/generations";

/*
 * Data is fetched in an effect rather than through a route `loader` — see the note in
 * routes/usage.tsx for why `useLoaderData()` cannot be typed in this app.
 */
export const Route = createFileRoute("/generations")({
	beforeLoad: async (): Promise<void> => {
		if (!(await getSession())) throw redirect({ to: "/login" });
	},
	component: Generations,
});

/** Micro-USD is the storage unit; this is the only place it becomes a price. */
function price(costMicroUsd: number | null, costSource: string | null): string {
	if (costMicroUsd === null) return "cost unknown";
	const formatted = `$${(costMicroUsd / 1_000_000).toFixed(6)}`;
	return costSource === "estimate" ? `${formatted} (est.)` : formatted;
}

/** Output tokens over wall-clock. `—` when either half was never recorded. */
function speed(outputTokens: number | null, latencyMs: number | null): string {
	if (!outputTokens || !latencyMs) return "—";
	return `${(outputTokens / (latencyMs / 1000)).toFixed(1)} tok/s`;
}

function Generations() {
	const [items, setItems] = useState<GenerationSummary[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => setItems(await getGenerations()), []);
	useEffect(() => {
		void load();
	}, [load]);

	const remove = async (id: string) => {
		setBusy(id);
		setError(null);
		try {
			setItems(await removeGeneration({ data: { id } }));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not delete that generation.",
			);
		} finally {
			setBusy(null);
		}
	};

	/** The manual version of what a page load already tries — with the reason shown. */
	const check = async (id: string) => {
		setBusy(id);
		setError(null);
		try {
			setItems(await recheckGeneration({ data: { id } }));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not check that generation right now.",
			);
		} finally {
			setBusy(null);
		}
	};

	// Two kinds of record, two shapes. An image is a thing you look at; an analysis is a
	// row of numbers about a request, and a grid of cards is the wrong frame for that.
	const images = useMemo(
		() => (items ?? []).filter((item) => item.kind === "image"),
		[items],
	);
	const analyses = useMemo(
		() => (items ?? []).filter((item) => item.kind === "analysis"),
		[items],
	);

	return (
		<AppShell
			title="Generations"
			description="Everything you asked us to keep. Requests made with syncing off are counted in Usage but not kept here."
		>
			{error ? (
				<Alert variant="destructive">
					<AlertTitle>That did not work</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			{items === null ? (
				<Spinner />
			) : items.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center">
						<p className="font-medium">Nothing kept yet</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Turn on <strong>Sync generations to the web app</strong> in the
							extension's settings, then analyse or generate an image.
						</p>
					</CardContent>
				</Card>
			) : (
				<>
					<section>
						<h2 className="mb-3 text-sm font-medium text-muted-foreground">
							Images ({images.length})
						</h2>
						{images.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No images kept yet.
							</p>
						) : (
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{images.map((item) => (
									<ImageCard
										key={item.id}
										item={item}
										busy={busy === item.id}
										onCheck={() => void check(item.id)}
										onDelete={() => void remove(item.id)}
									/>
								))}
							</div>
						)}
					</section>

					<section>
						<h2 className="mb-3 text-sm font-medium text-muted-foreground">
							Prompt generations ({analyses.length})
						</h2>
						<AnalysisTable
							rows={analyses}
							busy={busy}
							onDelete={(id) => void remove(id)}
						/>
					</section>
				</>
			)}
		</AppShell>
	);
}

function ImageCard({
	item,
	busy,
	onCheck,
	onDelete,
}: {
	item: GenerationSummary;
	busy: boolean;
	onCheck: () => void;
	onDelete: () => void;
}) {
	const [showPrompt, setShowPrompt] = useState(false);

	return (
		<Card className="overflow-hidden p-0">
			<div className="relative aspect-square bg-muted">
				{item.imageUrl ? (
					<img
						src={item.imageUrl}
						alt={item.prompt ?? "A generated image"}
						className="size-full object-cover"
						loading="lazy"
					/>
				) : (
					<div className="grid size-full place-items-center gap-3 p-4 text-center text-sm text-muted-foreground">
						{/* A row still running says so, rather than being drawn as a broken image.
                Opening this page tries to finish it; this button is how you try again
                without reloading — and it reports why, if it cannot. */}
						{item.status === "processing" ? (
							<>
								<span>{busy ? "Checking…" : "Still generating…"}</span>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={busy}
									onClick={onCheck}
								>
									Check now
								</Button>
							</>
						) : (
							<span>No image</span>
						)}
					</div>
				)}
				<div className="absolute top-2 left-2 flex flex-wrap gap-1">
					<Badge variant="secondary">{item.model.split("/").at(-1)}</Badge>
					{item.status !== "succeeded" ? (
						<Badge
							variant={item.status === "failed" ? "destructive" : "outline"}
						>
							{item.status}
						</Badge>
					) : null}
				</div>
			</div>

			<CardContent className="flex flex-col gap-3 p-4">
				<div>
					<p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
						<HugeiconsIcon icon={Clock01Icon} size={12} className="shrink-0" />
						{`${new Date(item.createdAt).toLocaleString()}, ${price(item.costMicroUsd, item.costSource)}, paid with ${item.mode === "byok" ? "your key" : "the free allowance"}`}
					</p>
					{item.prompt ? (
						<p className="mt-2 line-clamp-2 text-sm">{item.prompt}</p>
					) : (
						<p className="mt-2 text-sm text-muted-foreground">
							Prompt not retained.
						</p>
					)}
				</div>

				{item.prompt ? (
					<>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => setShowPrompt(!showPrompt)}
							aria-expanded={showPrompt}
						>
							{showPrompt ? "Hide prompt" : "Show prompt"}
						</Button>
						{showPrompt ? (
							<p className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
								{item.prompt}
							</p>
						) : null}
					</>
				) : null}

				<Separator />

				<div className="flex flex-wrap gap-2">
					{item.prompt ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() =>
								void navigator.clipboard.writeText(item.prompt ?? "")
							}
						>
							Copy
						</Button>
					) : null}
					{item.imageUrl ? (
						// A download is a link, not a button — and this Button has no `asChild`,
						// so it borrows the recipe rather than wrapping an anchor.
						<a
							href={item.imageUrl}
							download={`${item.id}.webp`}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							Download
						</a>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="ml-auto text-destructive"
						disabled={busy}
						onClick={onDelete}
					>
						Delete
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function AnalysisTable({
	rows,
	busy,
	onDelete,
}: {
	rows: GenerationSummary[];
	busy: string | null;
	onDelete: (id: string) => void;
}) {
	return (
		<Card className="overflow-hidden p-0">
			<CardContent className="overflow-x-auto p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>Model</TableHead>
							<TableHead>Input</TableHead>
							<TableHead>Output</TableHead>
							<TableHead>Cost</TableHead>
							<TableHead>Speed</TableHead>
							<TableHead>Paid by</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={8} className="text-muted-foreground">
									No prompt generations kept yet.
								</TableCell>
							</TableRow>
						) : (
							rows.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="whitespace-nowrap">
										{new Date(row.createdAt).toLocaleString()}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{row.model.split("/").at(-1)}
									</TableCell>
									<TableCell>
										{row.inputTokens === null ? "—" : `${row.inputTokens} tok`}
									</TableCell>
									<TableCell>
										{row.outputTokens === null
											? "—"
											: `${row.outputTokens} tok`}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{price(row.costMicroUsd, row.costSource)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{speed(row.outputTokens, row.latencyMs)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{row.mode === "byok" ? "your key" : "free allowance"}
									</TableCell>
									<TableCell className="text-right whitespace-nowrap">
										{row.prompt ? (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() =>
													void navigator.clipboard.writeText(row.prompt ?? "")
												}
											>
												Copy prompt
											</Button>
										) : null}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="text-destructive"
											disabled={busy === row.id}
											onClick={() => onDelete(row.id)}
										>
											Delete
										</Button>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
