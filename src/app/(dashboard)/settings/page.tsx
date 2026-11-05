import { Suspense } from "react";
import type { Metadata } from "next";
import {
  Bot,
  Database,
  Info,
  KeyRound,
  Plug,
  Server,
  ShieldCheck,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import {
  CapabilitySection,
} from "@/components/dashboard/capability";
import { DataControls } from "@/components/settings/data-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataStore } from "@/lib/db";
import { supabaseConfigured } from "@/lib/supabase/server";
import { listDiscoveryAdapters } from "@/features/discovery/service";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  await connection();

  const db = getDataStore();
  const health = await db.health();
  const adapters = listDiscoveryAdapters();
  const supabaseReady = supabaseConfigured();

  const aiProvider = process.env.JOBDEDO_AI_PROVIDER || null;
  const aiKeyPresent =
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.OPENAI_API_KEY) ||
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.OLLAMA_BASE_URL);

  const envRows: { label: string; state: "set" | "missing"; scope: string }[] = [
    {
      label: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      state: supabaseReady ? "set" : "missing",
      scope: "PostgreSQL storage (falls back to local file)",
    },
    {
      label: "JOBDEDO_AI_PROVIDER",
      state: aiProvider ? "set" : "missing",
      scope: "AI abstraction (Milestone 4+)",
    },
    {
      label: "GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY",
      state: aiKeyPresent ? "set" : "missing",
      scope: "At least one provider key (optional)",
    },
    {
      label: "OLLAMA_BASE_URL",
      state: process.env.OLLAMA_BASE_URL ? "set" : "missing",
      scope: "Local inference (optional)",
    },
    {
      label: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET",
      state:
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? "set"
          : "missing",
      scope: "Gmail OAuth send (Milestone 6, optional)",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Storage, integrations and data controls. Secrets stay server-side — none of these values are ever sent to the browser."
      />

      {/* System status */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          icon={Database}
          label="Storage driver"
          value={health.driver === "local" ? "Local JSON file" : "Supabase"}
          detail={health.message}
          tone={health.ok ? "success" : "warning"}
        />
        <StatusCard
          icon={Server}
          label="Database connectivity"
          value={health.driver === "local"
            ? "File-based store (no database)"
            : health.ok
              ? "PostgreSQL via service role"
              : "PostgreSQL unavailable"}
          detail={
            health.driver === "local"
              ? "Local JSON file at .data/jobdedo.local.json"
              : health.message
          }
          tone={health.driver === "local" ? "muted" : (health.ok ? "success" : "warning")}
        />
        <StatusCard
          icon={Plug}
          label="Discovery adapters"
          value={`${adapters.filter((a) => a.enabled).length} of ${adapters.length} enabled`}
          detail={
            adapters.some((a) => a.enabled)
              ? "Greenhouse · Lever · Ashby public APIs"
              : "Set DISCOVERY_*_BOARDS to enable a source"
          }
          tone={adapters.some((a) => a.enabled) ? "success" : "muted"}
        />
        <StatusCard
          icon={Bot}
          label="AI provider"
          value={aiProvider ?? "Not configured"}
          detail={aiProvider ? "Used for M4+ features" : "Optional until Milestone 4"}
          tone={aiProvider ? "success" : "muted"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Data controls */}
        <CapabilitySection
          icon={ShieldCheck}
          title="Data controls"
          badge="Your data"
        >
          <p className="text-xs text-muted-foreground">
            Export produces a single JSON document of every stored row.
            Deletion removes personal data only — sample listings and app
            configuration remain, and both actions hit real endpoints.
          </p>
          <DataControls />
        </CapabilitySection>

        {/* Environment variables */}
        <CapabilitySection
          icon={KeyRound}
          title="Environment variables"
          badge="Server-only"
        >
          <ul className="space-y-2">
            {envRows.map((row) => (
              <li
                key={row.label}
                className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px]" title={row.label}>
                    {row.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{row.scope}</p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    row.state === "set"
                      ? "shrink-0 border-success/40 bg-success/10 text-success"
                      : "shrink-0 text-muted-foreground"
                  }
                >
                  {row.state === "set" ? "Set" : "Not set"}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Nothing is required to run locally — without Supabase credentials
            JobDedo uses the file-backed store. See{" "}
            <code className="rounded bg-muted px-1">.env.example</code> for the
            full annotated list.
          </p>
        </CapabilitySection>
      </div>

      {/* Discovery adapters */}
      <CapabilitySection
        icon={Plug}
        title="Discovery sources"
        badge={`${adapters.length} registered`}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {adapters.map((adapter) => (
            <div
              key={adapter.key}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{adapter.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {adapter.status}
                </p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] text-muted-foreground"
              >
                {adapter.enabled ? "Enabled" : "Off"}
              </Badge>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Greenhouse, Lever and Ashby read only their official public JSON
          endpoints — no login, no CAPTCHA, no scraping of protected pages.
          Sources without a permitted feed (LinkedIn, Naukri, Indeed,
          Internshala) stay listed as not integrated. JobDedo never fabricates
          listings to make discovery look active.
        </p>
      </CapabilitySection>

      <Card className="card-shadow">
        <CardContent className="p-4 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Security model</p>
          <p className="mt-1">
            Single-user app — no auth layer (by design, spec §1). The Supabase
            service-role key is read only on the server; RLS is enabled on every
            table with no public policies; API inputs are Zod-validated and
            rate-limited; external pages are treated as untrusted input.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "muted";
}) {
  const tones = {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    muted: "bg-muted text-muted-foreground",
  } as const;

  return (
    <Card className="card-shadow">
      <CardContent className="flex items-start gap-3 p-4">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={detail}>
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
