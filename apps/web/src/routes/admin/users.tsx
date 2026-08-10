import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "#/components/shared/app-shell";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Spinner } from "#/components/ui/spinner";
import { getAccounts, saveAccountAllowance } from "#/server/admin";
import { getSession } from "#/server/auth";
import type { AccountAllowance } from "#/server/core/admin";

/*
 * Data is fetched in an effect rather than through a route `loader` — see the note in
 * routes/usage.tsx for why `useLoaderData()` cannot be typed in this app.
 */
export const Route = createFileRoute("/admin/users")({
	beforeLoad: async (): Promise<void> => {
		if (!(await getSession())) throw redirect({ to: "/login" });
	},
	component: AdminUsers,
});

/** Empty input ⇒ null ⇒ follow the deployment default. `0` is a real ceiling. */
function toLimit(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function fromLimit(counter: {
	limit: number;
	source: "default" | "override";
}): string {
	return counter.source === "override" ? String(counter.limit) : "";
}

function AdminUsers() {
	const [accounts, setAccounts] = useState<AccountAllowance[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				setAccounts(await getAccounts());
			} catch (cause) {
				setError(
					cause instanceof Error ? cause.message : "Could not load accounts.",
				);
				setAccounts([]);
			}
		})();
	}, []);

	return (
		<AppShell
			title="Account limits"
			description="Empty follows the deployment default; 0 takes the free allowance away. Raising a limit does not raise the deployment-wide ceiling, nor refund what today has already spent."
		>
			{error ? (
				<Alert variant="destructive">
					<AlertTitle>That did not work</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			{accounts === null ? (
				<Spinner />
			) : accounts.length === 0 && !error ? (
				<Card>
					<CardHeader>
						<CardTitle>No accounts</CardTitle>
						<CardDescription>Nobody has signed in yet.</CardDescription>
					</CardHeader>
				</Card>
			) : (
				accounts.map((account) => (
					<AccountCard
						key={account.userId}
						account={account}
						onSaved={setAccounts}
						onError={setError}
					/>
				))
			)}
		</AppShell>
	);
}

function AccountCard({
	account,
	onSaved,
	onError,
}: {
	account: AccountAllowance;
	onSaved: (accounts: AccountAllowance[]) => void;
	onError: (message: string | null) => void;
}) {
	const [analyses, setAnalyses] = useState(fromLimit(account.analyses));
	const [images, setImages] = useState(fromLimit(account.images));
	const [note, setNote] = useState(account.note ?? "");
	const [resetToday, setResetToday] = useState(false);
	const [saving, setSaving] = useState(false);

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setSaving(true);
		onError(null);
		try {
			onSaved(
				await saveAccountAllowance({
					data: {
						userId: account.userId,
						analysesLimit: toLimit(analyses),
						imagesLimit: toLimit(images),
						note: note.trim() ? note.trim() : null,
						resetToday,
					},
				}),
			);
			setResetToday(false);
		} catch (cause) {
			onError(
				cause instanceof Error ? cause.message : "Could not save that limit.",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2 text-base">
					{account.email}
					{account.analyses.source === "override" ||
					account.images.source === "override" ? (
						<Badge>custom limit</Badge>
					) : (
						<Badge variant="secondary">deployment default</Badge>
					)}
				</CardTitle>
				<CardDescription>
					Today: {account.analyses.used}/{account.analyses.limit} analyses and{" "}
					{account.images.used}/{account.images.limit} images
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={save}>
					<FieldGroup>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field>
								<FieldLabel htmlFor={`${account.userId}-analyses`}>
									Analyses per day
								</FieldLabel>
								<Input
									id={`${account.userId}-analyses`}
									type="number"
									min={0}
									inputMode="numeric"
									placeholder={`default (${account.analyses.limit})`}
									value={analyses}
									onChange={(event) => setAnalyses(event.target.value)}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${account.userId}-images`}>
									Images per day
								</FieldLabel>
								<Input
									id={`${account.userId}-images`}
									type="number"
									min={0}
									inputMode="numeric"
									placeholder={`default (${account.images.limit})`}
									value={images}
									onChange={(event) => setImages(event.target.value)}
								/>
							</Field>
						</div>
						<Field>
							<FieldLabel htmlFor={`${account.userId}-note`}>Note</FieldLabel>
							<Input
								id={`${account.userId}-note`}
								placeholder="Why this account is different"
								value={note}
								onChange={(event) => setNote(event.target.value)}
							/>
						</Field>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								className="h-4 w-4"
								checked={resetToday}
								onChange={(event) => setResetToday(event.target.checked)}
							/>
							Also reset today's counters
						</label>
						<Button type="submit" disabled={saving}>
							{saving ? "Saving…" : "Save limits"}
						</Button>
					</FieldGroup>
				</form>
			</CardContent>
			<CardFooter className="border-t">
				<p className="text-sm text-muted-foreground">
					Clearing both fields removes the override and returns this account to
					the deployment default.
				</p>
			</CardFooter>
		</Card>
	);
}
