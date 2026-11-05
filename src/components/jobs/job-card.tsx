import Link from "next/link";
import {
  Building2,
  Briefcase,
  ExternalLink,
  MapPin,
  Clock3,
  IndianRupee,
  CalendarDays,
  Radar,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MatchScore } from "./match-score";
import { SaveJobButton } from "./save-job-button";
import { VerificationBadge } from "./verification-badge";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatStipend,
  relativeTime,
  titleCase,
} from "@/lib/utils/format";
import type { JobWithRelations } from "@/types";

/** Company monogram (we never fabricate or proxy logos). */
export function CompanyAvatar({ name, logoUrl }: { name: string; logoUrl?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt=""
        className="size-10 rounded-lg border object-contain"
        width={40}
        height={40}
      />
    );
  }
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-secondary text-xs font-semibold text-secondary-foreground"
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function WorkModelBadge({ job }: { job: JobWithRelations }) {
  const labels: Record<string, string> = {
    remote: "Remote",
    hybrid: "Hybrid",
    onsite: "On-site",
  };
  return (
    <Badge variant="outline" className="text-[11px] font-medium">
      {labels[job.work_model] ?? job.work_model}
    </Badge>
  );
}

function compensation(job: JobWithRelations): string | null {
  if (job.employment_type === "internship" && job.stipend_amount != null) {
    return `${formatStipend(job.stipend_amount)} stipend`;
  }
  if (job.salary_min != null || job.salary_max != null) {
    const min = job.salary_min != null ? formatMoney(job.salary_min, job.salary_currency, "year") : null;
    const max = job.salary_max != null ? formatMoney(job.salary_max, job.salary_currency, "year") : null;
    if (min && max) return `${min} – ${max}`;
    return min ?? max;
  }
  return null;
}

/** Job card used in grid and list layouts on Discover / Saved / Overview. */
export function JobCard({
  job,
  layout = "grid",
  showSave = true,
}: {
  job: JobWithRelations;
  layout?: "grid" | "list";
  showSave?: boolean;
}) {
  const pay = compensation(job);
  const companyName = job.company?.name ?? "Unknown company";
  const discoveredAt = job.last_discovered_at ?? job.first_discovered_at;

  return (
    <Card
      className={cn(
        "card-shadow group relative h-full transition-shadow hover:shadow-md",
        layout === "list" && "h-auto",
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <CompanyAvatar name={companyName} logoUrl={job.company?.logo_url || undefined} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-xs font-medium text-muted-foreground">
                {companyName}
              </p>
              {job.source && (
                <Badge
                  variant="secondary"
                  className="h-4 px-1.5 text-[9px] font-semibold tracking-wide"
                  title={`Discovered from ${job.source.name} (${job.source.kind})`}
                >
                  {job.source.name}
                </Badge>
              )}
              {job.is_sample && (
                <Badge
                  variant="outline"
                  className="h-4 px-1 text-[9px] font-bold tracking-wider text-warning"
                  title="Sample listing created by JobDedo for demonstration — not a real job posting"
                >
                  SAMPLE
                </Badge>
              )}
            </div>

            <Link
              href={`/discover/${job.id}`}
              className="mt-0.5 block rounded-sm text-[15px] leading-snug font-semibold tracking-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {job.title}
            </Link>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <MatchScore score={job.match_score} />
            <VerificationBadge
              status={job.verification_status}
              score={job.verification_confidence || null}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden />
            {job.location_text || "Unspecified"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Briefcase className="size-3" aria-hidden />
            {titleCase(job.employment_type)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3" aria-hidden />
            {titleCase(job.experience_level)}
          </span>
          {pay && (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <IndianRupee className="size-3" aria-hidden />
              {pay}
            </span>
          )}
          {job.posted_at && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" aria-hidden />
              {relativeTime(job.posted_at)}
            </span>
          )}
          {job.closing_date && job.job_status !== "closed" && (
            <span className="inline-flex items-center gap-1 text-warning">
              <Clock3 className="size-3" aria-hidden />
              Closes {formatDate(job.closing_date)}
            </span>
          )}
          {discoveredAt && !job.is_sample && (
            <span
              className="inline-flex items-center gap-1"
              title={`Discovered ${formatDateTime(job.first_discovered_at)}${
                job.last_discovered_at && job.last_discovered_at !== job.first_discovered_at
                  ? ` · last seen ${formatDateTime(job.last_discovered_at)}`
                  : ""
              }`}
            >
              <Radar className="size-3" aria-hidden />
              {relativeTime(discoveredAt)}
            </span>
          )}
        </div>

        {job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {job.skills.slice(0, 6).map((skill) => (
              <span
                key={skill}
                className="rounded-md border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {skill}
              </span>
            ))}
            {job.skills.length > 6 && (
              <span className="text-[11px] text-muted-foreground">
                +{job.skills.length - 6}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/discover/${job.id}`}
              className="rounded-md text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              View details →
            </Link>
            {job.original_url && (
              <a
                href={job.original_url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open the original listing on ${job.source?.name ?? "the source platform"}`}
                className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Original posting
                <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </div>
          {showSave && <SaveJobButton jobId={job.id} saved={job.saved} />}
        </div>
      </CardContent>
    </Card>
  );
}
