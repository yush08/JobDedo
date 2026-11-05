import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { UserRound } from "lucide-react";

import { ProfileForm } from "@/components/profile/profile-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getProfileBundle } from "@/lib/db";
import { toProfileData } from "@/lib/db";
import { connection } from "next/server";
import type { ProfileInput } from "@/lib/validation/schemas";

export const metadata: Metadata = {
  title: "My Profile",
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}

async function ProfileContent() {
  await connection();
  const bundle = await getProfileBundle();

  // Strip persistence metadata — the form only edits the validated schema.
  const { id: _id, created_at: _c, updated_at: _u, ...data } = toProfileData(bundle);
  const initial = data as unknown as ProfileInput;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <UserRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          This is the <strong>only</strong> profile JobDedo keeps. Matching,
          verification warnings, resume tailoring and outreach all read from
          it.{" "}
          <Link
            href="/preferences"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Set search preferences →
          </Link>
        </p>
      </div>

      <ProfileForm initial={initial} />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
