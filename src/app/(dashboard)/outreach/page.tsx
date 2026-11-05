import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import OutreachClient from "./outreach-client";

export const metadata: Metadata = {
  title: "Cold Email Assistant",
};

export default function OutreachPage() {
  return (
    <Suspense fallback={<h1>Loading…</h1>}>
      <OutreachClient />
    </Suspense>
  );
}