"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  VERIFICATION_STATUSES,
  WORK_MODELS,
} from "@/types";
import { titleCase } from "@/lib/utils/format";

const ANY = "__any__";

interface Props {
  roles: string[];
  companies: string[];
  layout: "grid" | "list";
  onLayoutChange: (layout: "grid" | "list") => void;
}

/**
 * Discover-page filters. State lives in the URL (shareable, survives
 * refresh); every change resets to page 1.
 */
export function JobFilters({ roles, companies, layout, onLayoutChange }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [text, setText] = useState(searchParams.get("q") ?? "");

  const setParams = useCallback(
    (patch: Record<string, string>, resetPage = true) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value || value === ANY) next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const activeCount = useMemo(() => {
    let count = 0;
    for (const key of [
      "q",
      "role",
      "location",
      "work_model",
      "employment_type",
      "experience",
      "verification",
      "company",
      "skills",
      "min_salary",
      "posted_within_days",
    ]) {
      if (searchParams.get(key)) count++;
    }
    // Sample rows are included by default; turning them off is a filter too.
    if (searchParams.get("include_sample") === "false") count++;
    return count;
  }, [searchParams]);

  const field = (key: string) => searchParams.get(key) ?? "";

  const select = (
    key: string,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select
        value={field(key) || ANY}
        onValueChange={(value) => setParams({ [key]: value ?? "" })}
      >
        <SelectTrigger className="w-full min-w-36 bg-card" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="mb-5 space-y-3 rounded-xl border bg-card p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form
          className="flex min-w-0 flex-1 flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            setParams({ q: text.trim() });
          }}
        >
          <Label htmlFor="job-search" className="text-[11px] text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="job-search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Title, company, skill…"
              className="bg-card pl-8"
            />
          </div>
        </form>

        {select("sort", "Sort by", [
          { value: "best_match", label: "Best match" },
          { value: "recently_posted", label: "Recently posted" },
          { value: "recently_discovered", label: "Recently discovered" },
          { value: "highest_salary", label: "Highest salary" },
          { value: "deadline", label: "Deadline approaching" },
        ])}

        <div className="flex items-center gap-1.5 pb-0.5">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Layout">
            <Button
              variant={layout === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Grid view"
              aria-pressed={layout === "grid"}
              onClick={() => onLayoutChange("grid")}
            >
              <LayoutGrid aria-hidden />
            </Button>
            <Button
              variant={layout === "list" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="List view"
              aria-pressed={layout === "list"}
              onClick={() => onLayoutChange("list")}
            >
              <List aria-hidden />
            </Button>
          </div>

          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText("");
                router.replace(pathname, { scroll: false });
              }}
            >
              <X aria-hidden />
              Clear ({activeCount})
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select("role", "Role", roles.map((r) => ({ value: r, label: r })))}
        {select("location", "Location", [
          { value: "India", label: "India" },
          { value: "Remote", label: "Remote" },
          { value: "Bengaluru", label: "Bengaluru" },
          { value: "Delhi", label: "Delhi NCR" },
          { value: "Mumbai", label: "Mumbai" },
          { value: "Hyderabad", label: "Hyderabad" },
          { value: "Pune", label: "Pune" },
          { value: "Chennai", label: "Chennai" },
        ])}
        {select(
          "work_model",
          "Work model",
          WORK_MODELS.map((m) => ({ value: m, label: titleCase(m) })),
        )}
        {select(
          "employment_type",
          "Employment type",
          EMPLOYMENT_TYPES.map((m) => ({ value: m, label: titleCase(m) })),
        )}
        {select(
          "experience",
          "Experience",
          EXPERIENCE_LEVELS.map((m) => ({ value: m, label: titleCase(m) })),
        )}
        {select(
          "verification",
          "Verification",
          VERIFICATION_STATUSES.map((m) => ({ value: m, label: titleCase(m) })),
        )}
        {select("company", "Company", companies.map((c) => ({ value: c, label: c })))}
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="posted_within_days" className="text-[11px] text-muted-foreground">
            Posted within
          </Label>
          <Select
            value={field("posted_within_days") || ANY}
            onValueChange={(value) => setParams({ posted_within_days: value ?? "" })}
          >
            <SelectTrigger id="posted_within_days" className="w-full bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any time</SelectItem>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Listings</Label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm">
            <Checkbox
              checked={field("include_sample") !== "false"}
              onCheckedChange={(value) =>
                // Unchecking writes `include_sample=false`; checking removes the
                // param so the default (include) applies again.
                setParams({ include_sample: value === true ? "" : "false" })
              }
              aria-label="Include sample listings"
            />
            <span className="text-muted-foreground">Show sample rows</span>
          </label>
        </div>
      </div>
    </div>
  );
}
