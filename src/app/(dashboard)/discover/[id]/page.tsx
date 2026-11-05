import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Clock3,
  GraduationCap,
  HeartHandshake,
  MapPin,
  Timer,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CompanyAvatar, WorkModelBadge } from "@/components/jobs/job-card";
import { MatchScore } from "@/components/jobs/match-score";
import { SaveJobButton } from "@/components/jobs/save-job-button";
import { VerificationBadge } from "@/components/jobs/verification-badge";
import { TrackApplicationButton } from "@/components/jobs/track-application-button";
import { MatchExplanationCard } from "@/components/jobs/match-explanation";
import {
  DeadlineChip,
  JobLinksCard,
  VerificationPanel,
} from "@/components/verification/verification-panel";
import { loadJobDetail } from "@/lib/server/loaders";
import { toProfileData } from "@/lib/db";
import { formatDate, formatMoney, formatStipend, relativeTime, titleCase } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Job details",
};

export default function JobDetailsPage({ params }: PageProps<"/discover/[id]">) {
  return (
    <Suspense fallback={<JobDetailsSkeleton />}>
      <JobDetailsContent params={params} />
    </Suspense>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SkillTags({ skills, tone }: { skills: string[]; tone?: string }) {
  if (skills.length === 0) {
    return <p className="text-sm text-muted-foreground">Not specified.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <span
          key={skill}
          className={
            tone ??
            "rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground"
          }
        >
          {skill}
        </span>
      ))}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b py-4 last:border-b-0">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-tight">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

async function JobDetailsContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadJobDetail(id);
  if (!data) notFound();

  const { job, verification, history, bundle } = data;
  const company = job.company;
  const r = job.requirements;

  const pay =
    job.employment_type === "internship" && job.stipend_amount != null
      ? `${formatStipend(job.stipend_amount)} stipend`
      : job.salary_min != null || job.salary_max != null
        ? [
            job.salary_min != null
              ? formatMoney(job.salary_min, job.salary_currency, "year")
              : null,
            job.salary_max != null
              ? formatMoney(job.salary_max, job.salary_currency, "year")
              : null,
          ]
            .filter(Boolean)
            .join(" – ")
        : null;

  return (
    <div className="space-y-5">
      <Link
        href="/discover"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Discover
      </Link>

      {/* Header */}
      <Card className="card-shadow">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <CompanyAvatar
              name={company?.name ?? "Unknown company"}
              logoUrl={company?.logo_url || undefined}
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-medium text-muted-foreground">
                  {company?.name ?? "Unknown company"}
                </p>
                {job.is_sample && (
                  <Badge
                    variant="outline"
                    className="text-[9px] font-bold tracking-wider text-warning"
                    title="Sample listing — not a real job posting"
                  >
                    SAMPLE
                  </Badge>
                )}
              </div>

              <h1 className="mt-0.5 text-xl font-semibold tracking-tight md:text-2xl">
                {job.title}
              </h1>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" aria-hidden />
                  {job.location_text || "Unspecified"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5" aria-hidden />
                  {titleCase(job.employment_type)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap className="size-3.5" aria-hidden />
                  {titleCase(job.experience_level)}
                </span>
                {job.posted_at && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden />
                    Posted {relativeTime(job.posted_at)}
                  </span>
                )}
                {job.duration_days && (
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="size-3.5" aria-hidden />
                    {job.duration_days} days
                  </span>
                )}
                {pay && <span className="font-medium text-foreground">{pay}</span>}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <WorkModelBadge job={job} />
                <DeadlineChip job={job} />
                <VerificationBadge
                  status={job.verification_status}
                  score={job.verification_confidence || null}
                />
                {job.is_sample && (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    Discovered {relativeTime(job.first_discovered_at)}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
              <div className="flex items-center gap-3">
                <MatchScore score={job.match_score} size={58} />
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">Match</p>
                  <p>vs your profile</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <SaveJobButton jobId={job.id} saved={job.saved} size="sm" />
                <TrackApplicationButton
                  job={{
                    id: job.id,
                    title: job.title,
                    original_url: job.original_url,
                    application_url: job.application_url,
                  }}
                  companyName={company?.name ?? "Unknown company"}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Body */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="card-shadow">
            <CardContent className="px-5 py-2">
              <Section
                title="About the company"
                icon={<Building2 className="size-4 text-muted-foreground" aria-hidden />}
              >
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {r.about_company ||
                    company?.description ||
                    "No company description provided."}
                </p>
                {company?.industry && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Industry: {company.industry} · Size: {company.size_bucket}
                  </p>
                )}
              </Section>

              <Section title="Role description">
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {job.description || "No description provided."}
                </p>
              </Section>

              <Section
                title="Responsibilities"
                icon={<Wrench className="size-4 text-muted-foreground" aria-hidden />}
              >
                <BulletList
                  items={r.responsibilities}
                  empty="Not specified in the listing."
                />
              </Section>

              <Section title="Required skills">
                <SkillTags skills={r.required_skills} />
              </Section>

              <Section title="Preferred skills">
                <SkillTags skills={r.preferred_skills} />
              </Section>

              <Section
                title="Eligibility"
                icon={<GraduationCap className="size-4 text-muted-foreground" aria-hidden />}
              >
                <p className="text-sm">
                  {r.eligibility || "Not specified in the listing."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Experience requested: {r.experience_text || titleCase(job.experience_level)}
                </p>
              </Section>

              <Section
                title="Benefits"
                icon={<HeartHandshake className="size-4 text-muted-foreground" aria-hidden />}
              >
                <BulletList items={r.benefits} empty="Not specified." />
              </Section>

              <Section
                title="Duration & deadline"
                icon={<Clock3 className="size-4 text-muted-foreground" aria-hidden />}
              >
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>
                    Duration:{" "}
                    <strong>
                      {job.duration_days ? `${job.duration_days} days` : "Not specified"}
                    </strong>
                  </span>
                  <span>
                    Closing date:{" "}
                    <strong>{job.closing_date ? formatDate(job.closing_date) : "Not specified"}</strong>
                  </span>
                  <span>
                    Status: <strong className="capitalize">{job.job_status}</strong>
                  </span>
                </div>
              </Section>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <JobLinksCard job={job} verification={verification} />
          <MatchExplanationCard
            job={job}
            profile={toProfileData(bundle)}
            preferences={bundle.preferences}
            roles={bundle.roles}
          />
          <VerificationPanel job={job} verification={verification} history={history} />
        </div>
      </div>
    </div>
  );
}

function JobDetailsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-32" />
      <Card className="card-shadow">
        <CardContent className="flex gap-4 p-5">
          <Skeleton className="size-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="size-14 rounded-full" />
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="card-shadow lg:col-span-2">
          <CardContent className="space-y-4 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card className="card-shadow">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
