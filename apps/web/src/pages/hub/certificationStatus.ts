/** Shared renewal status for renewable certifications (badges, Team Insights). */

/** Days until expiry to treat as “expiring soon” (UI-only; not stored). */
export const EXPIRING_SOON_DAYS = 90;

export type CertificationRenewalStatus =
  | "active"
  | "expiring_soon"
  | "expired"
  | "no_expiry";

function parseYmd(s: string): Date | null {
  const d = new Date(`${s.trim()}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Status from expiry date; null / empty / unparseable expiry → no_expiry (“No expiry set” in UI). */
export function certificationRenewalStatus(
  expiryDate: string | null | undefined
): CertificationRenewalStatus {
  if (!expiryDate?.trim()) return "no_expiry";
  const exp = parseYmd(expiryDate);
  if (!exp) return "no_expiry";
  const today = startOfTodayUtc();
  const soon = new Date(today);
  soon.setUTCDate(soon.getUTCDate() + EXPIRING_SOON_DAYS);
  const expUtc = Date.UTC(
    exp.getFullYear(),
    exp.getMonth(),
    exp.getDate()
  );
  const tUtc = today.getTime();
  const sUtc = soon.getTime();
  if (expUtc < tUtc) return "expired";
  if (expUtc <= sUtc) return "expiring_soon";
  return "active";
}

export function certificationStatusLabel(
  status: CertificationRenewalStatus
): string {
  switch (status) {
    case "active":
      return "Active";
    case "no_expiry":
      return "No expiry set";
    case "expiring_soon":
      return "Expiring soon";
    case "expired":
      return "Expired";
  }
}

const URGENCY_ORDER: Record<CertificationRenewalStatus, number> = {
  expired: 0,
  expiring_soon: 1,
  active: 2,
  no_expiry: 3,
};

function compareExpiryYmd(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  if (!a?.trim() && !b?.trim()) return 0;
  if (!a?.trim()) return 1;
  if (!b?.trim()) return -1;
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return (
    Date.UTC(da.getFullYear(), da.getMonth(), da.getDate()) -
    Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())
  );
}

/**
 * Sort certifications for operational review: expired → expiring soon → active → no expiry.
 * Within the same tier, sorts by expiry date (earlier first), then title.
 */
export function sortCertificationsByRenewalUrgency<
  T extends { expiry_date?: string | null; title?: string | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = certificationRenewalStatus(a.expiry_date);
    const sb = certificationRenewalStatus(b.expiry_date);
    const tier = URGENCY_ORDER[sa] - URGENCY_ORDER[sb];
    if (tier !== 0) return tier;
    const byDate = compareExpiryYmd(a.expiry_date, b.expiry_date);
    if (byDate !== 0) return byDate;
    return String(a.title ?? "").localeCompare(String(b.title ?? ""));
  });
}
