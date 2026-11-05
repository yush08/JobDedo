import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AnalyticsSummary } from "@/features/analytics/aggregate";

/**
 * Analytics charts built from real stored rows only (spec §18).
 *
 * Plain SVG/CSS — no chart library. Nothing is interpolated beyond what
 * `aggregateAnalytics` computed from persisted data.
 */

/* ------------------------------ line chart ------------------------------ */

function JobsOverTimeChart({ data }: { data: AnalyticsSummary["jobs_over_time"] }) {
  const width = 640;
  const height = 180;
  const padX = 8;
  const padTop = 12;
  const padBottom = 22;

  const max = Math.max(1, ...data.map((d) => d.count));
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const points = data.map((d, i) => {
    const x = padX + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = padTop + innerH - (d.count / max) * innerH;
    return { ...d, x, y };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area =
    points.length > 0
      ? `${path} L${points[points.length - 1]!.x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${points[0]!.x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`
      : "";

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const hasAny = total > 0;

  // Sparse x labels: first, middle, last date.
  const labelIdx = [0, Math.floor(data.length / 2), data.length - 1].filter(
    (v, i, arr) => v >= 0 && arr.indexOf(v) === i,
  );

  return (
    <div>
      {!hasAny && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          No jobs discovered in the last 30 days.
        </p>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        role="img"
        aria-label={`Jobs discovered over the last 30 days: ${total} total`}
      >
        {/* gridlines */}
        {[0, 0.5, 1].map((t) => {
          const y = padTop + innerH - t * innerH;
          return (
            <g key={t}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeDasharray="3 4"
              />
              <text
                x={padX}
                y={y - 4}
                className="fill-muted-foreground"
                fontSize="9"
              >
                {Math.round(t * max)}
              </text>
            </g>
          );
        })}

        {area && (
          <path d={area} className="fill-primary/10" />
        )}
        <path
          d={path}
          fill="none"
          className="stroke-primary"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p) =>
          p.count > 0 ? (
            <circle
              key={p.date}
              cx={p.x}
              cy={p.y}
              r="2.5"
              className="fill-primary"
            />
          ) : null,
        )}

        {labelIdx.map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text
              key={i}
              x={p.x}
              y={height - 6}
              className="fill-muted-foreground"
              fontSize="9"
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
            >
              {p.date.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/* --------------------------- horizontal bars ---------------------------- */

function BarRow({
  label,
  count,
  max,
  color = "bg-primary",
}: {
  label: string;
  count: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <div className="min-w-0">
        <p className="truncate text-xs" title={label}>
          {label}
        </p>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
          />
        </div>
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground">
        {count}
      </span>
    </li>
  );
}

function BarList({
  items,
  emptyLabel,
  color,
}: {
  items: { label: string; count: number }[];
  emptyLabel: string;
  color?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <BarRow key={item.label} {...item} max={max} color={color} />
      ))}
    </ul>
  );
}

/* -------------------------- verification bars --------------------------- */

const VERIFY_COLORS: Record<string, string> = {
  VERIFIED: "bg-success",
  NEEDS_REVIEW: "bg-warning",
  UNVERIFIED: "bg-muted-foreground",
  CLOSED: "bg-destructive/70",
  INVALID: "bg-destructive",
};

function VerificationBars({ items }: { items: AnalyticsSummary["verification_distribution"] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No jobs to classify yet.
      </p>
    );
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <BarRow
          key={item.label}
          label={item.label}
          count={item.count}
          max={max}
          color={VERIFY_COLORS[item.label] ?? "bg-primary"}
        />
      ))}
    </ul>
  );
}

/* ---------------------------- stage bars -------------------------------- */

const STAGE_COLORS: Record<string, string> = {
  applied: "bg-primary",
  recruiter_contacted: "bg-primary/70",
  interview: "bg-warning",
  offer: "bg-success",
  rejected: "bg-destructive",
  withdrawn: "bg-muted-foreground",
};

function StageBars({ items }: { items: AnalyticsSummary["applications_by_stage"] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No applications tracked yet.
      </p>
    );
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <BarRow
          key={item.label}
          label={item.label.replace(/_/g, " ")}
          count={item.count}
          max={max}
          color={STAGE_COLORS[item.label] ?? "bg-primary"}
        />
      ))}
    </ul>
  );
}

/* ------------------------------ export ---------------------------------- */

export function AnalyticsCharts({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="card-shadow lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Jobs discovered — last 30 days</CardTitle>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {summary.jobs_over_time.reduce((s, d) => s + d.count, 0)} jobs
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <JobsOverTimeChart data={summary.jobs_over_time} />
        </CardContent>
      </Card>

      <Card className="card-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Applications by stage</CardTitle>
        </CardHeader>
        <CardContent>
          <StageBars items={summary.applications_by_stage} />
        </CardContent>
      </Card>

      <Card className="card-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Verification status</CardTitle>
        </CardHeader>
        <CardContent>
          <VerificationBars items={summary.verification_distribution} />
        </CardContent>
      </Card>

      <Card className="card-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Jobs by target role</CardTitle>
        </CardHeader>
        <CardContent>
          <BarList items={summary.by_role} emptyLabel="No role data yet." />
        </CardContent>
      </Card>

      <Card className="card-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Jobs by location</CardTitle>
        </CardHeader>
        <CardContent>
          <BarList items={summary.by_location} emptyLabel="No location data yet." />
        </CardContent>
      </Card>
    </div>
  );
}
