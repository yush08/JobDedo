"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, CornerDownLeft, FileSearch, Search } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ALL_NAV } from "@/config/navigation";
import type { ApiResponse, JobWithRelations, Paginated } from "@/types";

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Global search: page navigation plus a live job search against the stored
 * job list (GET /api/v1/jobs). Uses TanStack Query with a short debounce.
 */
export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    enabled: open,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: "8", sort: "best_match" });
      if (debounced) params.set("q", debounced);
      const res = await fetch(`/api/v1/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Search failed");
      const json = (await res.json()) as ApiResponse<Paginated<JobWithRelations>>;
      return json.ok ? json.data.items : [];
    },
  });

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_NAV.slice(0, 6);
    return ALL_NAV.filter((item) => item.label.toLowerCase().includes(q));
  }, [query]);

  const jobs = data ?? [];
  const busy = isFetching && debounced.length > 0;

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    setDebounced("");
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next: boolean) => onOpenChange(next)}
      title="Search JobDedo"
      description="Search stored jobs or jump to a page"
      className="top-[22%] sm:max-w-xl"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search jobs, pages…"
      />
      <CommandList>
        <CommandEmpty>
          {busy ? (
            <span className="block py-2 text-muted-foreground">Searching…</span>
          ) : (
            <span className="block py-2 text-muted-foreground">
              No results. {debounced ? "Try a different term." : "Type to search."}
            </span>
          )}
        </CommandEmpty>

        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.map((item) => (
              <CommandItem
                key={item.href}
                value={`page-${item.label}`}
                onSelect={() => go(item.href)}
              >
                <item.icon className="size-4 text-muted-foreground" aria-hidden />
                <span>{item.label}</span>
                {item.badge && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {item.badge}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {jobs.length > 0 && (
          <CommandGroup heading="Jobs">
            {jobs.map((job) => (
              <CommandItem
                key={job.id}
                value={`job-${job.title}-${job.company?.name ?? ""}`}
                onSelect={() => go(`/discover/${job.id}`)}
              >
                <FileSearch className="size-4 text-muted-foreground" aria-hidden />
                <span className="truncate">{job.title}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="size-3" aria-hidden />
                  {job.company?.name ?? "Unknown"}
                </span>
                <CornerDownLeft className="ml-auto size-3.5 opacity-50" aria-hidden />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!busy && !debounced && jobs.length === 0 && pages.length === 0 && (
          <CommandItem value="hint" disabled>
            <Search className="size-4" aria-hidden />
            Start typing to search stored jobs
          </CommandItem>
        )}
      </CommandList>
    </CommandDialog>
  );
}
