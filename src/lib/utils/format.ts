/**
 * Formatting helpers shared by server and client code.
 * Storage is always UTC; the UI renders local time.
 */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Deterministic formatting: explicit locale + timezone + options so server
  // and client produce identical output during SSR hydration.
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "—";
}

export function formatMoney(
  amount: number | null | undefined,
  currency: string,
  period?: "month" | "year" | "one_time" | null,
): string {
  if (amount == null) return "—";
  try {
    // Use explicit locale based on currency to ensure consistent SSR hydration.
    // en-IN for Indian rupees (lakhs/crores), en-US for US dollars, etc.
    const locale = currency === "INR" ? "en-IN" : "en-US";
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(amount);
    if (period === "month") return `${formatted}/mo`;
    if (period === "year") return `${formatted}/yr`;
    return formatted;
  } catch {
    return `${currency} ${amount}`;
  }
}

export function formatStipend(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return formatMoney(amount, "INR", "month");
}

export function formatDateRange(start: string, end: string): string {
  if (!start && !end) return "—";
  if (!end) return formatDate(start);
  if (!start) return formatDate(end);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(d)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d - today) / 86_400_000);
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
