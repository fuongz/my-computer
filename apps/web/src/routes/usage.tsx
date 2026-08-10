import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "#/components/shared/app-shell";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { Progress } from "#/components/ui/progress";
import { Separator } from "#/components/ui/separator";
import { Spinner } from "#/components/ui/spinner";
import { getSession } from "#/server/auth";
import type { UsageReport } from "#/server/core/generations";
import { getUsage } from "#/server/generations";

/*
 * Data is fetched in an effect rather than through a route `loader`.
 *
 * `Route.useLoaderData()` cannot be typed in this app: a route's inferred types flow
 * into the router type, the router type is what `Register` publishes, and
 * `createServerFn` reads `Register` to check that a response is serializable — so a
 * route whose loader calls a server function closes a type cycle, and TypeScript
 * resolves the loader-data type to `never`. The server functions themselves are typed
 * correctly, so calling them from the component keeps real types end to end.
 */
export const Route = createFileRoute("/usage")({
	beforeLoad: async (): Promise<void> => {
		if (!(await getSession())) throw redirect({ to: "/login" });
	},
	component: Usage,
});

/** Micro-USD is the storage unit; this is the only place it becomes a price. */
function dollars(costMicroUsd: number): string {
	return `$${(costMicroUsd / 1_000_000).toFixed(4)}`;
}

function Usage() {
	const [usage, setUsage] = useState<UsageReport | null>(null);

	useEffect(() => {
		void (async () => setUsage(await getUsage()))();
	}, []);

	return (
		<AppShell
			title="Usage"
			description="What the free allowance permits, and what has actually been spent."
		>
			{usage === null ? <Spinner /> : <Report usage={usage} />}
		</AppShell>
	);
}

/**
 * One allowance as a meter.
 *
 * A limit is easier to read as a bar than as a fraction: the number says how much, the
 * bar says how close. `limit` of zero would divide by zero, so it reads as full — which
 * is also what it means, since a zero ceiling refuses everything.
 */
function Meter({
	label,
	counter,
}: {
	label: string;
	counter: { limit: number; used: number; source: "default" | "override" };
}) {
	const percent =
		counter.limit === 0
			? 100
			: Math.min(100, (counter.used / counter.limit) * 100);

	return (
		<Card>
			<CardContent className="flex flex-col gap-3 py-5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="font-medium">{label}</p>
					{counter.source === "override" ? (
						<Badge variant="secondary">custom limit</Badge>
					) : null}
				</div>
				<p className="text-sm">
					<span className="font-semibold">{counter.used}</span>
					<span className="text-muted-foreground">
						{" "}
						used of {counter.limit}
					</span>
				</p>
				{/* `Progress` renders its own track and indicator after any children, so it
            takes the value and nothing else. */}
				<Progress value={percent} />
			</CardContent>
		</Card>
	);
}

function Report({ usage }: { usage: UsageReport }) {
	const total = (lines: { costMicroUsd: number }[]) =>
		lines.reduce((sum, line) => sum + line.costMicroUsd, 0);

	return (
		<>
			{usage.systemCeilingReached ? (
				<Alert variant="destructive">
					<AlertTitle>
						The shared free allowance is used up for today
					</AlertTitle>
					<AlertDescription>
						Requests that would use this deployment's own provider keys are
						refused until {new Date(usage.resetsAt).toLocaleString()}. Adding
						your own provider key keeps you working regardless.
					</AlertDescription>
				</Alert>
			) : null}

			<div>
				<p className="mb-3 text-sm text-muted-foreground">
					Free allowance, resets {new Date(usage.resetsAt).toLocaleString()}
				</p>
				<div className="flex flex-col gap-3">
					<Meter label="Image analyses" counter={usage.allowance.analyses} />
					<Meter label="Image generations" counter={usage.allowance.images} />
				</div>
			</div>

			<div>
				<p className="mb-3 text-sm text-muted-foreground">
					Spend: a record, not a limit. Nothing here blocks a request made with
					your own key.
				</p>
				<div className="grid gap-3 lg:grid-cols-2">
					{(
						[
							["Today", usage.today],
							["Last 30 days", usage.last30Days],
						] as const
					).map(([label, lines]) => (
						<Card key={label}>
							<CardContent className="flex flex-col gap-3 py-5">
								<div className="flex items-baseline justify-between gap-2">
									<p className="font-medium">{label}</p>
									<p className="text-lg font-semibold">
										{dollars(total(lines))}
									</p>
								</div>
								{lines.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No requests yet.
									</p>
								) : (
									lines.map((line, index) => (
										<div key={`${line.provider}-${line.mode}`}>
											{index > 0 ? <Separator className="mb-3" /> : null}
											<div className="flex items-center justify-between gap-4">
												<div>
													<p className="text-sm font-medium">{line.provider}</p>
													<p className="text-xs text-muted-foreground">
														{line.mode === "byok"
															? "your key"
															: "free allowance"}
														, {line.requests} request
														{line.requests === 1 ? "" : "s"}
													</p>
												</div>
												<span className="text-sm">
													{dollars(line.costMicroUsd)}
												</span>
											</div>
										</div>
									))
								)}
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</>
	);
}
