"use client";

import { Menu, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav, BottomNav, Brand } from "./sidebar-nav";
import { GlobalSearch } from "./global-search";
import { Notifications } from "./notifications";

/** Top bar: mobile navigation, global search, notifications. */
export function Topbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur-sm md:px-8">
      {/* Mobile navigation */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open navigation"
            />
          }
        >
          <Menu aria-hidden />
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-16 items-center border-b px-4">
            <Brand collapsed={false} />
          </div>
          <nav className="px-3 py-4">
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <div className="my-4 h-px bg-border" />
            <BottomNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      {/* Global search */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Search jobs and pages"
      >
        <Search className="size-4" aria-hidden />
        <span className="truncate">Search jobs, pages…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Notifications />
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
