import { AlertTriangle, CheckCircle2, FolderGit2, Lightbulb, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchScore } from "@/components/jobs/match-score";
import { MatchButton } from "@/components/jobs/match-button";
import { computeMatch } from "@/features/matching/score";
import { cn } from "@/lib/utils";
import type { MatchBreakdown, ProfileData, JobWithRelations, JobPreferences, RolePreference } from "@/types";

const SEGMENTS: { key: keyof MatchBreakdown; label: string }[] = [
  { key: "technical_skills", label: "Technical skill alignment" },
  { key: "projects", label: "Project relevance" },
  { key: "role_alignment", label: "Role alignment" },
  { key: "education", label: "Education & eligibility" },
  { key: "experience", label: "Experience" },
  { key: "location", label: "Location & work preferences" },
  { key: "additional", label: "Additional requirements" },
];

/**
 * Explainable match breakdown (spec §12). Weighted scoring computed live
 * against the Master Profile — an internal estimate, not an employer ATS
 * score, and no prediction of selection.
 */
export function MatchExplanationCard({
  job,
  profile,
  preferences,
  roles,
}: {
  job: JobWithRelations;
  profile: ProfileData;
  preferences: JobPreferences | null;
  roles: RolePreference[];
}) {
  // Computed live via the same pure engine used by POST /jobs/[id]/match.
  const match = computeMatch(job, profile, preferences, roles);

  return (
    <Card className="card-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="size-4 text-primary" aria-hidden />
          Why this match?
        </CardTitle>
        <div className="flex items-center gap-2">
          <MatchScore score={match.score} size={46} />
          <MatchButton jobId={job.id} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {SEGMENTS.map((segment) => {
            const value = match.breakdown[segment.key];
            const isZero = value === 0;
            return (
              <li key={segment.key} className="flex items-center gap-2 text-xs">
                <span className="w-44 shrink-0 truncate text-muted-foreground">
                  {segment.label}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      isZero ? "bg-destructive/60" : "bg-primary",
                    )}
                    style={{ width: `${Math.max(2, value)}%` }}
                    title={`${value} points`}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums">{value}</span>
              </li>
            );
          })}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Strong matches ({match.matched_skills.length})
            </p>
            {match.matched_skills.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No overlapping skills detected yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {function () {
                  /* Deduplicate matched skills using case-insensitive comparison,
                     preserving the original display label. Skills appearing in both
                     required and preferred job lists are deduplicated here. */
                  const deduplicatedMatchedSkills = Array.from(
                    new Map(
                      match.matched_skills
                        .map((skill) => [skill.trim().toLowerCase(), skill])
                    ).values()
                  ).slice(0, 10);
                  return (
                    <div className="flex flex-wrap gap-1">
                      {deduplicatedMatchedSkills.map((skill) => (
                        <span
                          key={skill.trim().toLowerCase()}
                          className="rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[11px] text-success"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  );
                }()}
              </div>
            )}

          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning">
              <AlertTriangle className="size-3.5" aria-hidden />
              Missing skills ({match.missing_skills.length})
            </p>
            {match.missing_skills.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing required appears to be missing.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {function () {
                  /* Deduplicate missing skills using case-insensitive comparison,
                     preserving the original display label. */
                  const deduplicatedMissingSkills = Array.from(
                    new Map(
                      match.missing_skills
                        .map((skill) => [skill.trim().toLowerCase(), skill])
                    ).values()
                  ).slice(0, 10);
                  return (
                    <div className="flex flex-wrap gap-1">
                      {deduplicatedMissingSkills.map((skill) => (
                        <span
                          key={skill.trim().toLowerCase()}
                          className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  );
                }()}
              </div>
            )}
          </div>
        </div>

        {match.relevant_projects.length > 0 && (
          <div className="rounded-lg border p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
              <FolderGit2 className="size-3.5 text-primary" aria-hidden />
              Relevant projects
            </p>
            <p className="text-xs text-muted-foreground">
              {match.relevant_projects.join(" · ")}
            </p>
          </div>
        )}

        {match.eligibility_warnings.length > 0 && (
          <ul className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3">
            {match.eligibility_warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        )}

        {match.recommendations.length > 0 && (
          <div className="rounded-lg border p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
              <Lightbulb className="size-3.5 text-primary" aria-hidden />
              Recommendations
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {match.recommendations.map((item) => (
                <li key={item} className="flex gap-1.5">
                  <span aria-hidden>•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          JobDedo's own estimate of fit against your profile — not an employer
          ATS score, and not a prediction of whether you will be shortlisted.
        </p>
      </CardContent>
    </Card>
  );
}