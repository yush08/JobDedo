import { AppShell } from "@/components/layout/app-shell";

/**
 * Dashboard shell: collapsible sidebar + topbar with global search and
 * notifications. The shell itself renders no database data (it stays in the
 * static shell); every page loads its own data behind a Suspense boundary.
 *
 * `instant = false`: the shell's nav reads the current URL (`usePathname`)
 * for active states, which is request-time data — the dashboard is rendered
 * per request anyway, so the segment is allowed to block (Next 16 Cache
 * Components).
 */
export const instant = false;

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
