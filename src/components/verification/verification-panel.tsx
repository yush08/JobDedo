import {
  Building2,
  CalendarCheck,
  CheckCircle2,
  CircleHelp,
  Clock3,
  ExternalLink,
  History,
  Link2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchScore } from "@/components/jobs/match-score";
import { RecheckButton } from "./recheck-button";
import { interpretConfidence } from "@/features/verification/confidence";
import { formatDateTime, formatDate, daysUntil } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type {
  CheckResult,
  ConfidenceBreakdown,
  DeadlineStatus,
  ExactJobStatus,
  Job,
  JobVerification,
  LinkStatus,
  VerificationHistoryEntry,
} from "@/types";

/* ------------------------------- labels -------------------------------- */

const CHECK_LABEL: Record<CheckResult, string> = {
  confirmed: "Confirmed",
  uncertain: "Uncertain",
  not_found: "Not found",
  failed: "Failed to check",
  conflict: "Conflicting information",
  not_checked: "Not checked",
};

const EXACT_LABEL: Record<ExactJobStatus, string> = {
  confirmed_official: "Confirmed on official careers page",
  confirmed_platform: "Found on employer-linked recruitment platform",
  not_found_official: "Not found on official careers page",
  unable_to_verify: "Unable to verify",
  conflicting: "Conflicting information",
  not_checked: "Not checked yet",
};

const DEADLINE_LABEL: Record<DeadlineStatus, string> = {
  valid: "Valid",
  expired: "Expired",
  not_specified: "Not specified",
  uncertain: "Uncertain",
};

const LINK_LABEL: Record<LinkStatus, string> = {
  working: "Working",
  broken: "Broken",
  redirected: "Redirected",
  unable_to_check: "Unable to check",
  not_checked: "Not checked",
};

function toneFor(value: string): string {
  if (["confirmed", "valid", "working", "confirmed_official", "confirmed_platform"].includes(value)) {
    return "text-success";
  }
  if (["uncertain", "redirected", "conflicting", "conflict", "unable_to_check", "unable_to_verify", "uncertain_status"].includes(value)) {
    return "text-warning";
  }
  if (["failed", "broken", "expired", "conflict"].includes(value)) return "text-destructive";
  return "text-muted-foreground";
}

function AnswerRow({
  question,
  answer,
  url,
  urlLabel,
  tone,
  detail,
}: {
  question: string;
  answer: string;
  url?: string;
  urlLabel?: string;
  tone?: string;
  detail?: string;
}) {
  return (
    <li className="flex flex-col gap-0.5 border-b py-2.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{question}</span>
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className={cn(tone ?? "text-foreground")}>{answer}</span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            {urlLabel ?? "Open"}
          </a>
        ) : (
          urlLabel && (
            <span className="text-xs text-muted-foreground/80">{urlLabel}</span>
          )
        )}
      </span>
      {detail && <span className="text-xs text-muted-foreground/80">{detail}</span>}
    </li>
  );
}

const BREAKDOWN_ROWS: {
  key: keyof Omit<ConfidenceBreakdown, "total">;
  label: string;
  max: number;
}[] = [
  { key: "official_source", label: "Official source confirmation", max: 30 },
  { key: "application_link", label: "Application link status", max: 20 },
  { key: "active_status", label: "Active job status", max: 20 },
  { key: "company_identity", label: "Company identity", max: 15 },
  { key: "content_consistency", label: "Description / contact consistency", max: 10 },
  { key: "freshness", label: "Freshness", max: 5 },
];

/**
 * Sources & Verification panel (spec §9): company website, careers page,
 * exact-job confirmation, deadline status, link checks, timestamps and the
 * explainable confidence score with its evidence history.
 */
export function VerificationPanel({
  job,
  verification,
  history,
}: {
  job: Job;
  verification: JobVerification | null;
  history: VerificationHistoryEntry[];
}) {
  const score = verification?.confidence_score ?? job.verification_confidence;
  const band = interpretConfidence(score);
  const v = verification;

  return (
    <Card className="card-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Sources &amp; Verification
        </CardTitle>
        <RecheckButton jobId={job.id} />
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Confidence score */}
        <div className="flex items-center gap-4 rounded-xl border p-3">
          <MatchScore score={score} size={58} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{band.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{band.description}</p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Score breakdown
          </p>
          <ul className="space-y-1.5">
            {BREAKDOWN_ROWS.map((row) => {
              const value = (v?.confidence_breakdown?.[row.key] ?? 0) as number;
              return (
                <li key={row.key} className="flex items-center gap-2 text-xs">
                  <span className="w-44 shrink-0 truncate text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(value / row.max) * 100}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums">
                    {value}/{row.max}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This is JobDedo&apos;s internal confidence estimate based on collected
            evidence — not a guarantee from the employer, and not an ATS score.
          </p>
        </div>

        {/* Answers to the core questions */}
        <ul>
          <AnswerRow
            question="Does the company have a legitimate official website?"
            answer={CHECK_LABEL[v?.website_status ?? "not_checked"]}
            url={v?.company_website_url || undefined}
            urlLabel={v?.company_website_url ? undefined : "Not found"}
            tone={toneFor(v?.website_status ?? "not_checked")}
            detail="A reachable website alone does not prove a company is legitimate."
          />
          <AnswerRow
            question="Was the official careers page found?"
            answer={CHECK_LABEL[v?.careers_status ?? "not_checked"]}
            url={v?.careers_page_url || undefined}
            urlLabel={
              v?.careers_page_url
                ? (v.careers_discovery_method ? `via ${v.careers_discovery_method}` : "careers page")
                : "Not found"
            }
            tone={toneFor(v?.careers_status ?? "not_checked")}
            detail={
              v?.careers_evidence_url
                ? `Evidence: ${v.careers_evidence_url}`
                : "JobDedo never invents a careers URL — discovery ships in Milestone 3."
            }
          />
          <AnswerRow
            question="Does the exact job appear on the careers page?"
            answer={EXACT_LABEL[v?.exact_job_status ?? "not_checked"]}
            tone={toneFor(v?.exact_job_status ?? "not_checked")}
            detail="A job missing from the careers page is not automatically fraudulent."
          />
          <AnswerRow
            question="Is the deadline still valid?"
            answer={DEADLINE_LABEL[v?.deadline_status ?? "not_specified"]}
            tone={toneFor(v?.deadline_status ?? "not_specified")}
            detail={
              job.closing_date
                ? `Published closing date: ${formatDate(job.closing_date)}`
                : "No closing date published."
            }
          />
          <AnswerRow
            question="Has the employer marked the role closed?"
            answer={job.job_status === "closed" ? "Yes — marked closed" : job.job_status === "open" ? "No — treated as open" : "Unknown"}
            tone={job.job_status === "closed" ? "text-destructive" : undefined}
            detail={
              job.job_status === "closed"
                ? "Excluded from active recommendations."
                : "HTTP 200 alone does not prove a job is open."
            }
          />
          <AnswerRow
            question="Is the application link working?"
            answer={LINK_LABEL[v?.application_link_status ?? "not_checked"]}
            tone={toneFor(v?.application_link_status ?? "not_checked")}
            detail={v?.notes || "No probe has been run yet — click Recheck."}
          />
        </ul>

        {/* Timestamps */}
        <div className="rounded-xl border p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            Timestamps (stored UTC, shown in your local time)
          </p>
          <dl className="grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">First discovered</dt>
              <dd className="font-medium sm:mt-0.5">{formatDateTime(job.first_discovered_at)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="font-medium sm:mt-0.5">{formatDateTime(job.last_checked_at)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">Last verified</dt>
              <dd className="font-medium sm:mt-0.5">{formatDateTime(job.last_verified_at)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">Next scheduled check</dt>
              <dd className="font-medium sm:mt-0.5">
                {job.next_check_at ? formatDateTime(job.next_check_at) : "Not scheduled"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Evidence history */}
        <Accordion className="w-full">
          <AccordionItem value="history" className="border-b-0">
            <AccordionTrigger className="rounded-lg border px-3 py-2 text-sm hover:no-underline">
              <span className="flex items-center gap-2">
                <History className="size-4 text-muted-foreground" aria-hidden />
                Evidence &amp; verification history ({history.length})
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-2">
              {history.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  No checks recorded yet. Run a Recheck to record the first
                  entry — history is append-only and never overwritten.
                </p>
              ) : (
                <ul className="space-y-2">
                  {history.map((entry) => (
                    <li key={entry.id} className="rounded-lg border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{entry.check_type}</span>
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            toneFor(entry.result),
                          )}
                        >
                          {CHECK_LABEL[entry.result]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{entry.notes}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/80">
                        <span>{formatDateTime(entry.created_at)}</span>
                        <span>· {entry.source}</span>
                        {entry.evidence_url && (
                          <a
                            href={entry.evidence_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Link2 className="size-3" aria-hidden />
                            evidence
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {job.is_sample && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            Sample listing: there is no real source page for this row, so
            website/careers/link checks cannot produce evidence.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------- application links --------------------------- */

function LinkOrStatus({
  label,
  href,
  statusLabel,
  icon: Icon,
}: {
  label: string;
  href?: string | null;
  statusLabel: string;
  icon: typeof ExternalLink;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
      <span className="inline-flex min-w-0 items-center gap-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          Open
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">{statusLabel}</span>
      )}
    </li>
  );
}

/**
 * Separate, honest link list. The company homepage is NEVER substituted for
 * a missing application URL; missing values render as Not found / Not
 * confirmed.
 */
export function JobLinksCard({
  job,
  verification,
}: {
  job: Job;
  verification?: JobVerification | null;
}) {
  const exactUrl =
    verification?.exact_job_status === "confirmed_official" ||
    verification?.exact_job_status === "confirmed_platform"
      ? (verification?.exact_job_url || null)
      : null;

  return (
    <Card className="card-shadow">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4 text-primary" aria-hidden />
          Application &amp; source links
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          <LinkOrStatus
            label="Original job posting"
            href={job.original_url || null}
            statusLabel={job.is_sample ? "Sample listing — no source" : "Not found"}
            icon={ExternalLink}
          />
          <LinkOrStatus
            label="Official company website"
            href={verification?.company_website_url || null}
            statusLabel="Not confirmed"
            icon={Building2}
          />
          <LinkOrStatus
            label="Official careers page"
            href={verification?.careers_page_url || null}
            statusLabel="Not found"
            icon={Building2}
          />
          <LinkOrStatus
            label="Exact official job listing"
            href={exactUrl}
            statusLabel={exactUrl ? "Not confirmed" : "Not confirmed"}
            icon={ShieldCheck}
          />
          <LinkOrStatus
            label="Direct application link"
            href={job.application_url || null}
            statusLabel={job.is_sample ? "Sample listing — no link" : "Not found"}
            icon={Link2}
          />
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Missing links are shown as-is. JobDedo never substitutes a company
          homepage for a missing application URL.
        </p>
      </CardContent>
    </Card>
  );
}

/* --------------------------- status helpers ---------------------------- */

export function DeadlineChip({ job }: { job: Job }) {
  const days = daysUntil(job.closing_date);
  if (!job.closing_date || days === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CalendarCheck className="size-3" aria-hidden />
        No deadline specified
      </Badge>
    );
  }
  const closed = days < 0 || job.job_status === "closed";
  return (
    <Badge
      variant="outline"
      className={closed ? "border-destructive/40 text-destructive" : "text-warning"}
    >
      {closed ? (
        <XCircle className="size-3" aria-hidden />
      ) : (
        <CheckCircle2 className="size-3" aria-hidden />
      )}
      {closed ? "Closed" : `Closes ${formatDate(job.closing_date)} (${days}d)`}
    </Badge>
  );
}
