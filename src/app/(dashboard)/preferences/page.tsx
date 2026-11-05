import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";

import { PreferencesForm } from "@/components/preferences/preferences-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getProfileBundle } from "@/lib/db";
import { connection } from "next/server";
import type { PreferencesPayload } from "@/lib/validation/schemas";

export const metadata: Metadata = {
  title: "Preferences",
};

export default function PreferencesPage() {
  return (
    <Suspense fallback={<PreferencesSkeleton />}>
      <PreferencesContent />
    </Suspense>
  );
}

async function PreferencesContent() {
  await connection();
  const bundle = await getProfileBundle();

  const initial = {
    roles: bundle.roles.map((role) => ({
      role: role.role,
      is_custom: role.is_custom,
      priority: role.priority,
    })),
    preferences: {
      employment_types: bundle.preferences.employment_types,
      experience_levels: bundle.preferences.experience_levels,
      custom_experience_range: bundle.preferences.custom_experience_range,
      locations: bundle.preferences.locations,
      work_models: bundle.preferences.work_models,
      prefer_internship_duration_days:
        bundle.preferences.prefer_internship_duration_days,
      paid_internship_only: bundle.preferences.paid_internship_only,
      min_stipend: bundle.preferences.min_stipend,
      min_salary: bundle.preferences.min_salary,
      compensation_flexible: bundle.preferences.compensation_flexible,
      required_skills: bundle.preferences.required_skills,
      preferred_technologies: bundle.preferences.preferred_technologies,
      industries: bundle.preferences.industries,
      company_size: bundle.preferences.company_size,
      company_stage: bundle.preferences.company_stage,
      application_deadline_within_days:
        bundle.preferences.application_deadline_within_days,
      excluded_companies: bundle.preferences.excluded_companies,
      excluded_roles: bundle.preferences.excluded_roles,
      search_frequency_hours: bundle.preferences.search_frequency_hours,
    },
  } as PreferencesPayload;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          Preferences tune ranking — they never fabricate data.{" "}
          <Link
            href="/profile"
            className="font-medium text-primary underline-offset-2 hover:underline"
            >
            Edit your profile →
          </Link>
        </p>
      </div>

      <PreferencesForm initial={initial} />
    </div>
  );
}

function PreferencesSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
