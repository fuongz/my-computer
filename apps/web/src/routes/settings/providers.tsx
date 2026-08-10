import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "#/components/shared/app-shell";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Spinner } from "#/components/ui/spinner";
import { getSession } from "#/server/auth";
import type { CredentialStatus } from "#/server/core/providers";
import {
	getProviderKeys,
	removeProviderKey,
	saveProviderKey,
} from "#/server/providers";

/*
 * Data is fetched in an effect rather than through a route `loader` — see the note in
 * routes/usage.tsx for why `useLoaderData()` cannot be typed in this app.
 */
export const Route = createFileRoute("/settings/providers")({
	beforeLoad: async (): Promise<void> => {
		if (!(await getSession())) throw redirect({ to: "/login" });
	},
	component: Providers,
});

const LABELS: Record<
	string,
	{ name: string; hint: string; initials: string; manageUrl: string }
> = {
	openrouter: {
		name: "OpenRouter",
		hint: "Pays for image analysis — turning a picture into a prompt.",
		initials: "OR",
		manageUrl: "https://openrouter.ai/keys",
	},
	replicate: {
		name: "Replicate",
		hint: "Pays for image generation.",
		initials: "RP",
		manageUrl: "https://replicate.com/account/api-tokens",
	},
};

function Providers() {
	const [keys, setKeys] = useState<CredentialStatus[] | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => setKeys(await getProviderKeys()), []);
	useEffect(() => {
		void load();
	}, [load]);

	return (
		<AppShell
			title="BYOK"
			description="Use your own provider keys instead of the free daily allowance."
		>
			<Alert>
				<AlertTitle>Your own key, or the free allowance</AlertTitle>
				<AlertDescription>
					With a key of your own, that provider is unmetered and billed to you —
					we record what each call cost and never block one. With no key,
					requests use this deployment's shared key and a small free daily
					allowance instead. The choice is per provider: a key for one leaves
					the other on the allowance.
				</AlertDescription>
			</Alert>

			{error ? (
				<Alert variant="destructive">
					<AlertTitle>That did not work</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			{keys === null ? (
				<Spinner />
			) : (
				<Card className="overflow-hidden p-0">
					<CardContent className="p-0">
						{keys.map((key, index) => (
							<ProviderRow
								key={key.provider}
								status={key}
								first={index === 0}
								expanded={open === key.provider}
								onToggle={() =>
									setOpen(open === key.provider ? null : key.provider)
								}
								onChanged={(next) => {
									setKeys(next);
									setOpen(null);
								}}
								onError={setError}
							/>
						))}
					</CardContent>
				</Card>
			)}
		</AppShell>
	);
}

/**
 * One provider as a row that opens into its own form.
 *
 * A list of providers reads as a list whether or not any are configured, and the form
 * for the one being changed is the only one on screen — which is what keeps this from
 * looking like a page of password fields.
 */
function ProviderRow({
	status,
	first,
	expanded,
	onToggle,
	onChanged,
	onError,
}: {
	status: CredentialStatus;
	first: boolean;
	expanded: boolean;
	onToggle: () => void;
	onChanged: (keys: CredentialStatus[]) => void;
	onError: (message: string | null) => void;
}) {
	const label = LABELS[status.provider] ?? {
		name: status.provider,
		hint: "",
		initials: status.provider.slice(0, 2).toUpperCase(),
		manageUrl: "",
	};
	const [secret, setSecret] = useState("");
	const [busy, setBusy] = useState(false);

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setBusy(true);
		onError(null);
		try {
			onChanged(
				await saveProviderKey({ data: { provider: status.provider, secret } }),
			);
			setSecret("");
		} catch (cause) {
			onError(
				cause instanceof Error ? cause.message : "Could not save that key.",
			);
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		setBusy(true);
		onError(null);
		try {
			onChanged(
				await removeProviderKey({ data: { provider: status.provider } }),
			);
		} catch (cause) {
			onError(
				cause instanceof Error ? cause.message : "Could not remove that key.",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={first ? "" : "border-t"}>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/50"
			>
				<span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">
					{label.initials}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-medium">{label.name}</span>
					<span className="block truncate text-xs text-muted-foreground">
						{label.hint}
					</span>
				</span>
				{status.last4 ? (
					<Badge>Configured — ending in {status.last4}</Badge>
				) : (
					<span className="text-sm text-muted-foreground">Not configured</span>
				)}
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					size={16}
					className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
			</button>

			{expanded ? (
				<div className="border-t bg-muted/30 px-4 py-4">
					<form onSubmit={save}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={`${status.provider}-secret`}>
									{status.last4 ? "Replace key" : "Add key"}
								</FieldLabel>
								<Input
									id={`${status.provider}-secret`}
									type="password"
									autoComplete="off"
									placeholder={
										status.last4 ? "Paste a new key" : "Paste your key"
									}
									value={secret}
									onChange={(event) => setSecret(event.target.value)}
									required
								/>
							</Field>
							<div className="flex flex-wrap items-center gap-2">
								<Button type="submit" size="sm" disabled={busy}>
									{status.last4 ? "Replace key" : "Save key"}
								</Button>
								{status.last4 ? (
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={busy}
										onClick={() => void remove()}
									>
										Remove
									</Button>
								) : null}
								{label.manageUrl ? (
									<a
										href={label.manageUrl}
										target="_blank"
										rel="noreferrer"
										className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
									>
										Manage keys at {label.name}
									</a>
								) : null}
							</div>
							<p className="text-xs text-muted-foreground">
								{status.last4
									? "Stored encrypted. Only the last four characters are ever shown again."
									: "Stored encrypted, and never shown back to the browser."}
							</p>
						</FieldGroup>
					</form>
				</div>
			) : null}
		</div>
	);
}
