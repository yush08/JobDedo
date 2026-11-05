"use client";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/** Responsive application shell: collapsible sidebar + topbar + main region. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only z-100 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
