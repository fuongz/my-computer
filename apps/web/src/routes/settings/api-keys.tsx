import { PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "#/components/shared/app-shell";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { authClient } from "#/lib/auth-client";
import { getSession } from "#/server/auth";

/** What the extension asks for. Kept here so the setup hint cannot drift from reality. */
const RATE_LIMIT = "60 requests per minute";

export const Route = createFileRoute("/settings/api-keys")({
	beforeLoad: async (): Promise<void> => {
		if (!(await getSession())) throw redirect({ to: "/login" });
	},
	component: ApiKeys,
});

interface KeyRow {
	id: string;
	name: string | null;
	start: string | null;
	requestCount?: number | null;
	lastRequest?: Date | string | null;
	expiresAt?: Date | string | null;
}

function when(value: Date | string | null | undefined): string {
	if (!value) return "Never";
	return new Date(value).toLocaleString();
}

function ApiKeys() {
	const [keys, setKeys] = useState<KeyRow[] | null>(null);
	const [query, setQuery] = useState("");
	const [name, setName] = useState("");
	const [created, setCreated] = useState("");

	const load = useCallback(async () => {
		const result = await authClient.apiKey.list({ query: { limit: 50 } });
		setKeys(result.data ? (result.data.apiKeys as KeyRow[]) : []);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const shown = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle || keys === null) return keys ?? [];
		return keys.filter((key) =>
			(key.name ?? "").toLowerCase().includes(needle),
		);
	}, [keys, query]);

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		const result = await authClient.apiKey.create({ name, prefix: "fz_" });
		if (result.data) {
			setCreated(result.data.key);
			setName("");
			await load();
		}
	};

	return (
		<AppShell
			title="API keys"
			description="Create and manage your API keys."
			actions={
				<Dialog>
					<DialogTrigger
						render={
							<Button size="sm">
								<HugeiconsIcon icon={PlusSignIcon} size={16} />
								New key
							</Button>
						}
					/>
					<DialogContent>
						<form onSubmit={create}>
							<DialogHeader>
								<DialogTitle>Create a key</DialogTitle>
								<DialogDescription>
									Shown once, on creation. Each key is limited to {RATE_LIMIT}.
								</DialogDescription>
							</DialogHeader>
							<FieldGroup className="py-4">
								<Field>
									<FieldLabel htmlFor="key-name">Key name</FieldLabel>
									<Input
										id="key-name"
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder="Chrome extension"
										required
									/>
								</Field>
							</FieldGroup>
							<DialogFooter>
								<DialogClose
									render={<Button variant="secondary" type="button" />}
								>
									Cancel
								</DialogClose>
								<Button type="submit">Create key</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			}
		>
			{created ? (
				<Alert>
					<AlertTitle>Copy your new key now — it is not shown again</AlertTitle>
					<AlertDescription>
						<code className="break-all">{created}</code>
					</AlertDescription>
				</Alert>
			) : null}

			<Alert>
				<AlertTitle>What a key is for</AlertTitle>
				<AlertDescription>
					One key connects the browser extension — or any other client — to the
					generation API. Paste it into the extension's settings along with the
					API base URL, and it will stop calling OpenRouter and Replicate
					itself.
				</AlertDescription>
			</Alert>

			<Card className="overflow-hidden p-0">
				<CardContent className="p-0">
					<div className="relative border-b p-3">
						<HugeiconsIcon
							icon={Search01Icon}
							size={16}
							className="absolute top-1/2 left-6 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search by name…"
							className="max-w-sm pl-9"
							aria-label="Search keys by name"
						/>
					</div>

					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Key</TableHead>
									<TableHead>Requests</TableHead>
									<TableHead>Last used</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{keys === null ? (
									<TableRow>
										<TableCell colSpan={5} className="text-muted-foreground">
											Loading…
										</TableCell>
									</TableRow>
								) : shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={5} className="text-muted-foreground">
											{keys.length === 0
												? "No API keys yet."
												: "No keys match that name."}
										</TableCell>
									</TableRow>
								) : (
									shown.map((key) => (
										<TableRow key={key.id}>
											<TableCell>
												<p className="font-medium">{key.name ?? "Unnamed"}</p>
												{/* The stored prefix is all there is — the rest of the key was
                            never kept, which is the point. */}
												<p className="font-mono text-xs text-muted-foreground">
													{key.start ? `${key.start}…` : "hidden"}
												</p>
											</TableCell>
											<TableCell>{key.requestCount ?? 0}</TableCell>
											<TableCell>{when(key.lastRequest)}</TableCell>
											<TableCell>{when(key.expiresAt)}</TableCell>
											<TableCell className="text-right">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={async () => {
														await authClient.apiKey.delete({ keyId: key.id });
														await load();
													}}
												>
													Revoke
												</Button>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					<div className="border-t px-4 py-3 text-sm text-muted-foreground">
						{keys === null
							? "…"
							: `${keys.length} key${keys.length === 1 ? "" : "s"}. Revoked keys cannot be restored.`}
					</div>
				</CardContent>
			</Card>
		</AppShell>
	);
}
