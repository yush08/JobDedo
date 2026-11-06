"use client";

import { useState, useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SidebarNav, BottomNav, Brand } from "./sidebar-nav";
import { Separator } from "@/components/ui/separator";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "@/lib/utils/sidebar-preference";

/**
 * Desktop sidebar. Collapsible, persisted in localStorage.
 * - Initial render is always expanded (collapsed=false) for SSR hydration
 *   safety — the server and client render the same markup, so there is no
 *   hydration mismatch.
 * - After hydration, the stored preference is applied so an intentional
 *   collapse survives refresh and navigation. Only an explicit stored "1"
 *   collapses; anything else (missing, junk, storage throwing) keeps the
 *   default expanded state — see src/lib/utils/sidebar-preference.ts.
 * - Application data never lives in localStorage; this is purely UI preference.
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  // After hydration, apply saved preference from localStorage.
  // Initial render is always collapsed=false for SSR hydration safety.
  useEffect(() => {
    if (readSidebarCollapsed()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(true);
    }
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCollapsed(next);
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-[76px]" : "w-[248px]",
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-16 items-center px-4">
        <Brand collapsed={collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <SidebarNav collapsed={collapsed} />
        <Separator className="my-4" />
        <BottomNav collapsed={collapsed} />
      </nav>

      <div className="border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className={cn("w-full justify-start text-muted-foreground", collapsed && "justify-center px-0")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden />
          ) : (
            <>
              <PanelLeftClose aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
