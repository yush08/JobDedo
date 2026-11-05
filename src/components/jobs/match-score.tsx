import { cn } from "@/lib/utils";

/**
 * Match score ring (JobDedo's own estimate of fit against the Master
 * Profile — not an employer ATS score).
 */
export function MatchScore({
  score,
  size = 44,
  className,
}: {
  score: number | null | undefined;
  size?: number;
  className?: string;
}) {
  if (score == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
        title="No match computed yet"
      >
        —
      </span>
    );
  }

  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const tone =
    score >= 75 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--primary)";

  return (
    <span
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      title={`Match ${score}/100 — JobDedo's estimate of fit, not an employer ATS score`}
      role="img"
      aria-label={`Match score ${score} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={4}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums">{score}</span>
    </span>
  );
}
