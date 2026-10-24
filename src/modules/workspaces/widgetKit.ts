import logger from "../../utils/logger-config";
import type { NeedsItem, WidgetResult, WorkspaceContext, WorkspaceRange, RangeKey } from "./types";

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Current period to date, compared with the whole previous period of the same kind. */
export const resolveRange = (raw: unknown, now = new Date()): WorkspaceRange => {
  const key = (["WEEK", "MONTH", "QUARTER", "YEAR"].includes(String(raw).toUpperCase())
    ? String(raw).toUpperCase()
    : "WEEK") as RangeKey;
  const today = startOfDay(now);
  let from: Date;
  let prevFrom: Date;
  if (key === "WEEK") {
    const dow = (today.getUTCDay() + 6) % 7; // Monday start
    from = new Date(today.getTime() - dow * DAY);
    prevFrom = new Date(from.getTime() - 7 * DAY);
  } else if (key === "MONTH") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    prevFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  } else if (key === "QUARTER") {
    const q = Math.floor(today.getUTCMonth() / 3) * 3;
    from = new Date(Date.UTC(today.getUTCFullYear(), q, 1));
    prevFrom = new Date(Date.UTC(today.getUTCFullYear(), q - 3, 1));
  } else {
    from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    prevFrom = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1));
  }
  const to = new Date(now.getTime());
  const prevTo = new Date(from.getTime() - 1);
  const month = (d: Date) => d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const label = { WEEK: "This week", MONTH: "This month", QUARTER: "This quarter", YEAR: "This year" }[key];
  const compare_label = {
    WEEK: "vs last week",
    MONTH: `vs ${month(prevFrom)}`,
    QUARTER: `vs Q${Math.floor(prevFrom.getUTCMonth() / 3) + 1}`,
    YEAR: `vs ${prevFrom.getUTCFullYear()}`,
  }[key];
  return { key, label, compare_label, from, to, prevFrom, prevTo };
};

/** The `n` periods of the selected kind ending with the current one, oldest first. */
export const trailingPeriods = (range: WorkspaceRange, n: number) => {
  const out: { from: Date; to: Date }[] = [];
  let from = range.from;
  let to = range.to;
  for (let i = 0; i < n; i += 1) {
    out.unshift({ from, to });
    to = new Date(from.getTime() - 1);
    if (range.key === "WEEK") from = new Date(from.getTime() - 7 * DAY);
    else {
      const months = range.key === "MONTH" ? 1 : range.key === "QUARTER" ? 3 : 12;
      from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1));
    }
  }
  return out;
};

export const deltaPct = (cur: number | null, prev: number | null) => {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
};

/** Runs one widget; a failure becomes `{ ok:false }` so the rest of the page still renders. */
export const runWidget = async (
  id: string,
  fn: () => Promise<unknown>,
): Promise<[string, WidgetResult]> => {
  try {
    return [id, { ok: true, data: await fn() }];
  } catch (error) {
    logger.error(`[workspaces] widget ${id} failed`, error);
    return [id, { ok: false, error: "Couldn't load this widget" }];
  }
};

/**
 * Runs widgets in parallel. Each entry is `[id, permission | null, fn]`; widgets
 * whose permission check fails are omitted, not locked.
 */
export const runWidgets = async (
  ctx: WorkspaceContext,
  entries: [string, [string, "view" | "manage" | "admin"] | null, () => Promise<unknown>][],
) => {
  const allowed = await Promise.all(
    entries.map(([, perm]) => (perm ? ctx.can(perm[0], perm[1]) : Promise.resolve(true))),
  );
  const results = await Promise.all(
    entries.filter((_, i) => allowed[i]).map(([id, , fn]) => runWidget(id, fn)),
  );
  return Object.fromEntries(results);
};

/** Keeps only needs that point at a widget the caller got, with a positive count. */
export const keepNeeds = (needs: NeedsItem[], widgets: Record<string, unknown>) =>
  needs.filter((n) => n.count > 0 && n.widget in widgets);
