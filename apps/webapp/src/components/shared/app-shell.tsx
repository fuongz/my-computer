import { DashboardSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ThemeToggle } from "#/components/shared/theme-toggle.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
} from "#/components/ui/sidebar.tsx";
import { TOOLS } from "#/tools/registry.ts";

/**
 * The frame every page renders inside: sidebar, page title, content.
 *
 * A component rather than a layout route, because each page passes its own title and
 * the routes are otherwise independent — and because a pathless layout route would
 * put a second thing on the router's type graph for no gain.
 */
export function AppShell({
	title,
	description,
	actions,
	children,
}: {
	title: string;
	description?: string;
	/** Rendered on the title row, right-aligned — the page's own controls. */
	actions?: ReactNode;
	children: ReactNode;
}) {
	// Base UI's `render` prop makes a menu button BECOME the link rather than wrap
	// one, so the active state has to come from the router directly.
	const { pathname } = useLocation();

	return (
		<SidebarProvider>
			<Sidebar>
				<SidebarHeader className="px-4 py-3">
					<p className="font-semibold tracking-tight">fuongz</p>
					<p className="text-xs text-muted-foreground">Bộ công cụ cá nhân</p>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/"}
										render={<Link to="/" />}
									>
										<HugeiconsIcon icon={DashboardSquare01Icon} size={16} />
										<span>Tổng quan</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>

					<SidebarGroup>
						<SidebarGroupLabel>Công cụ</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{TOOLS.map((tool) => (
									<SidebarMenuItem key={tool.id}>
										<SidebarMenuButton
											isActive={pathname.startsWith(tool.to)}
											render={<Link to={tool.to} />}
										>
											<HugeiconsIcon icon={tool.icon} size={16} />
											<span>{tool.name}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>

			<SidebarInset>
				<header className="flex items-center gap-3 border-b px-4 py-4 sm:px-6">
					<SidebarTrigger className="-ml-1" />
					<Separator orientation="vertical" className="h-5" />
					<div className="min-w-0 flex-1">
						<h1 className="truncate text-xl font-semibold tracking-tight">
							{title}
						</h1>
						{description ? (
							<p className="truncate text-sm text-muted-foreground">
								{description}
							</p>
						) : null}
					</div>
					{actions}
					<ThemeToggle />
				</header>
				<div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
