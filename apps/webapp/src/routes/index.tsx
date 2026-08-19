import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "#/components/shared/app-shell.tsx";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { TOOLS } from "#/tools/registry.ts";

// A route exports exactly one thing: `Route`. The moment it exports a second,
// something imports the route to get it, and a URL declaration lands on the import
// graph of your components. Extract instead — to hooks/ or components/.
export const Route = createFileRoute("/")({
	component: Dashboard,
});

function Dashboard() {
	return (
		<AppShell
			title="Tổng quan"
			description="Những công cụ nhỏ tự làm cho việc riêng."
		>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{TOOLS.map((tool) => (
					<Link key={tool.id} to={tool.to} className="group outline-none">
						<Card className="h-full transition-colors group-hover:border-primary/40 group-focus-visible:ring-3 group-focus-visible:ring-ring/40">
							<CardHeader>
								<span className="mb-1 grid size-9 place-items-center rounded-lg bg-muted text-foreground">
									<HugeiconsIcon icon={tool.icon} size={18} />
								</span>
								<CardTitle className="flex items-center gap-1.5">
									{tool.name}
									<HugeiconsIcon
										icon={ArrowRight01Icon}
										size={16}
										className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
									/>
								</CardTitle>
								<CardDescription>{tool.description}</CardDescription>
							</CardHeader>
						</Card>
					</Link>
				))}
			</div>
		</AppShell>
	);
}
