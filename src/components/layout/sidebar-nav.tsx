"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { BOTTOM_NAV, MAIN_NAV, type NavItem } from "@/config/navigation";

function Items({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", active && "text-primary")}
                aria-hidden
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return <Items items={MAIN_NAV} collapsed={collapsed} onNavigate={onNavigate} />;
}

export function BottomNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return <Items items={BOTTOM_NAV} collapsed={collapsed} onNavigate={onNavigate} />;
}

/** JobDedo wordmark + mark. */
export function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/overview" className="flex items-center gap-2.5 outline-none">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground neo-shadow-sm">
        <Sparkles className="size-4" aria-hidden />
      </span>
      {!collapsed && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">JobDedo</span>
          <span className="mt-0.5 text-[10px] text-muted-foreground">
            Find jobs. Get noticed. Get hired.
          </span>
        </span>
      )}
    </Link>
  );
}