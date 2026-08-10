import {
  ChartLineData01Icon,
  ImageAdd02Icon,
  Key01Icon,
  SlidersHorizontalIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Separator } from "#/components/ui/separator";
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
} from "#/components/ui/sidebar";
import { getIsAdmin } from "#/server/admin";

const SECTIONS = [
  {
    label: "Library",
    items: [
      { to: "/generations", label: "Generations", icon: ImageAdd02Icon },
      { to: "/usage", label: "Usage", icon: ChartLineData01Icon },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings/providers", label: "BYOK", icon: SlidersHorizontalIcon },
      { to: "/settings/api-keys", label: "API keys", icon: Key01Icon },
    ],
  },
] as const;

/**
 * The frame every signed-in page renders inside: sidebar, page title, content.
 *
 * A component rather than a layout route, because each page passes its own title and
 * the routes are otherwise independent — and because a pathless layout route would put
 * a second thing on the router's type graph, which is what made `useLoaderData()`
 * untypeable here in the first place.
 */
export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  /** Rendered on the title row, right-aligned — a primary action for the page. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Only shown to admins, and only for discoverability — /admin/users guards itself,
  // so a hidden link is not what keeps anybody out.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    void (async () => setIsAdmin(await getIsAdmin()))();
  }, []);

  // Base UI's `render` prop is how a menu button BECOMES the link, rather than
  // wrapping one — so the active state has to come from the router directly.
  const { pathname } = useLocation();

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3">
          <p className="font-semibold tracking-tight">fuongz</p>
          <p className="text-xs text-muted-foreground">Image generation</p>
        </SidebarHeader>
        <SidebarContent>
          {SECTIONS.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={pathname === item.to}
                        render={<Link to={item.to} />}
                      >
                        <HugeiconsIcon icon={item.icon} size={16} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}

          {isAdmin ? (
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={pathname === "/admin/users"}
                      render={<Link to="/admin/users" />}
                    >
                      <HugeiconsIcon icon={UserGroupIcon} size={16} />
                      <span>Account limits</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="flex items-center gap-3 border-b px-6 py-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="truncate text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
