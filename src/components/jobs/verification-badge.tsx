import type { VerificationStatus } from "@/types";
import { cn } from "@/lib/utils";
import {
  BadgeCheck,
  CircleAlert,
  CircleSlash,
  Clock3,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";

const CONFIG: Record<
  VerificationStatus,
  { label: string; className: string; Icon: typeof BadgeCheck }
> = {
  VERIFIED: {
    label: "Verified",
    className: "border-success/30 bg-success/10 text-success",
    Icon: BadgeCheck,
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    className: "border-warning/30 bg-warning/10 text-warning",
    Icon: ShieldAlert,
  },
  UNVERIFIED: {
    label: "Unverified",
    className: "border-border bg-muted text-muted-foreground",
    Icon: ShieldQuestion,
  },
  CLOSED: {
    label: "Closed",
    className: "border-border bg-muted text-muted-foreground",
    Icon: CircleSlash,
  },
  EXPIRED: {
    label: "Expired",
    className: "border-border bg-muted text-muted-foreground",
    Icon: Clock3,
  },
  INVALID: {
    label: "Invalid",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    Icon: CircleAlert,
  },
};

/**
 * Verification status pill. This is JobDedo's own confidence estimate based
 * on collected evidence — never a guarantee from the employer.
 */
export function VerificationBadge({
  status,
  score,
  className,
}: {
  status: VerificationStatus;
  score?: number | null;
  className?: string;
}) {
  const { label, className: tone, Icon } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tone,
        className,
      )}
      title={
        score != null
          ? `${label} — JobDedo confidence ${score}/100 (internal estimate, not a guarantee)`
          : `${label} — JobDedo's internal confidence estimate`
      }
    >
      <Icon className="size-3" aria-hidden />
      {label}
      {score != null && <span className="tabular-nums opacity-80">{score}</span>}
    </span>
  );
}
