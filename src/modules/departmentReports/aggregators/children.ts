/**
 * Children report.
 *
 * Children are members under 18 (same rule as the Membership Analytics children
 * toggle, by year of birth). They are reported here, separately from the
 * Membership report, which counts only adults. A child "joined" when their
 * record was created (`created_at`); "active" follows the member active flag.
 *
 * Definitions mirror the membership report where they overlap:
 * - A child is a non-guest, non-anonymised `user` under 18 as of the period end.
 * - Active = `is_active` true or null.
 * - Profile complete = date of birth, gender, an emergency contact, and a phone
 *   or an address on file (children often share a guardian's contact).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { addDays, monthLabel, shortDate } from "../period";
import {
  AM,
  BZ,
  GR,
  MG,
  NV,
  RD,
  SF,
  bars,
  byBranch,
  changeWords,
  emptyBody,
  flag,
  hbars,
  healthOf,
  kpi,
  list,
  nf,
  pctOf,
  perBucket,
  round1,
  segments,
  sortFlags,
  stats,
} from "../sections";
import { FlagDTO, ReportBuilder, SectionDTO } from "../types";
import { ageAt, isChildBirthYear } from "./age";

const DAY = 86_400_000;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MEMBERS_PATH = "/home/membership";

const childSelect = {
  id: true,
  name: true,
  email: true,
  created_at: true,
  is_active: true,
  membership_type: true,
  branch_id: true,
  user_info: {
    select: {
      first_name: true,
      last_name: true,
      date_of_birth: true,
      gender: true,
      primary_number: true,
      email: true,
      address: true,
      city: true,
      country: true,
      emergency_contact_id: true,
    },
  },
} satisfies Prisma.userSelect;

type Child = Prisma.userGetPayload<{ select: typeof childSelect }>;
type Range = { from: Date; to: Date };

const isActive = (c: Child) => c.is_active !== false;
const existedBy = (c: Child, at: Date) => c.created_at < at;
const activeAt = (children: Child[], at: Date) => children.filter((c) => isActive(c) && existedBy(c, at)).length;
const within = (d: Date | null | undefined, r: Range) => !!d && d >= r.from && d < r.to;
const newIn = (children: Child[], r: Range) => children.filter((c) => within(c.created_at, r));

const AGE_BANDS: { label: string; max: number; color: string }[] = [
  { label: "Under 2", max: 1, color: NV },
  { label: "2–5", max: 5, color: BZ },
  { label: "6–9", max: 9, color: SF },
  { label: "10–13", max: 13, color: MG },
  { label: "14–17", max: 17, color: GR },
];
const ageBandOf = (c: Child, at: Date) => {
  const dob = c.user_info?.date_of_birth;
  if (!dob) return null;
  const age = ageAt(dob, at);
  return AGE_BANDS.find((b) => age <= b.max)?.label ?? null;
};

const countBy = <T>(items: T[], keyOf: (item: T) => string | null) => {
  const out = new Map<string, number>();
  items.forEach((item) => {
    const key = keyOf(item);
    if (key) out.set(key, (out.get(key) || 0) + 1);
  });
  return out;
};

const filled = (v: unknown) => v != null && String(v).trim() !== "";
const isProfileComplete = (c: Child) => {
  const info = c.user_info;
  if (!info) return false;
  return (
    filled(info.date_of_birth) &&
    filled(info.gender) &&
    filled(info.emergency_contact_id) &&
    (filled(info.primary_number) || filled(info.address))
  );
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
const isGhana = (country: string | null | undefined) =>
  !filled(country) || /^(gh|gha)$|ghana/i.test(String(country).trim());
const placeOf = (c: Child) => {
  const info = c.user_info;
  if (!info) return null;
  if (!isGhana(info.country)) return "Outside Ghana";
  return filled(info.city) ? titleCase(String(info.city).trim()) : null;
};

const plural = (n: number, one: string, many: string) => `${nf(n)} ${n === 1 ? one : many}`;

export const buildChildren: ReportBuilder = async (ctx) => {
  const branchWhere = getBranchScopedWhere(ctx.branchId);
  const memberWhere: Prisma.userWhereInput = {
    AND: [
      branchWhere || {},
      { OR: [{ is_guest: false }, { is_guest: null }] },
      { NOT: { name: { startsWith: "Deleted User" } } },
    ],
  };
  const range: Range = { from: ctx.from, to: ctx.to };
  const asOf = ctx.to < ctx.now ? ctx.to : ctx.now;

  const all = await prisma.user.findMany({ where: memberWhere, select: childSelect });
  // Only members under 18 as of the period end (year-of-birth rule).
  const children = all.filter((c) => isChildBirthYear(c.user_info?.date_of_birth, asOf));

  const newChildren = newIn(children, range);

  /* ------------------------------- KPIs -------------------------------- */
  const activeNow = activeAt(children, asOf);
  const activePrev = activeAt(children, ctx.prev.to);
  const activeYoy = activeAt(children, ctx.yoy.to);
  const activeSpark = ctx.trend.map((b) => activeAt(children, b.to < ctx.now ? b.to : ctx.now));

  const prevNew = newIn(children, ctx.prev).length;
  const yoyNew = newIn(children, ctx.yoy).length;
  const newSpark = perBucket(children, ctx.trend, (c) => c.created_at);

  const activeChildren = children.filter((c) => isActive(c) && existedBy(c, asOf));
  const inactiveCount = children.filter((c) => !isActive(c)).length;
  const completeCount = activeChildren.filter(isProfileComplete).length;
  const completePct = activeChildren.length ? round1(pctOf(completeCount, activeChildren.length)) : null;
  const noEmergency = activeChildren.filter((c) => !c.user_info?.emergency_contact_id).length;

  const kpis = [
    kpi("active_children", "Children", activeNow, { prev: activePrev, yoy: activeYoy, spark: activeSpark }),
    kpi("new_children", "New children", newChildren.length, { prev: prevNew, yoy: yoyNew, spark: newSpark }),
    kpi("with_emergency_contact", "With emergency contact", activeChildren.length - noEmergency, {
      sub: activeChildren.length
        ? `${Math.round(pctOf(activeChildren.length - noEmergency, activeChildren.length))}% of children`
        : null,
    }),
    kpi("profiles_complete", "Profiles complete", completePct, {
      format: "pct",
      sub: activeChildren.length ? `${nf(completeCount)} of ${nf(activeChildren.length)} children` : null,
    }),
  ];

  /* ------------------------------- Flags ------------------------------- */
  const flags: FlagDTO[] = [];
  if (noEmergency > 0) {
    flags.push(
      flag(
        pctOf(noEmergency, activeChildren.length) >= 10 ? "act" : "watch",
        `${plural(noEmergency, "child has", "children have")} no emergency contact on file`,
        "View children",
        `${MEMBERS_PATH}?age=child`,
      ),
    );
  }
  if (prevNew >= 4 && newChildren.length <= prevNew * 0.75) {
    flags.push(
      flag(
        "watch",
        `New children fell by ${Math.round((1 - newChildren.length / prevNew) * 100)}% to ${nf(newChildren.length)}, from ${nf(prevNew)} in ${ctx.prev.label}`,
      ),
    );
  }
  if (completePct != null && completePct < 60) {
    flags.push(flag("watch", `Only ${Math.round(completePct)}% of children's profiles are complete`));
  }
  const sortedFlags = sortFlags(flags);

  /* ----------------------------- Sections ------------------------------ */
  const sections: SectionDTO[] = [];

  sections.push(
    bars(
      "growth",
      "Growth trend",
      "New children in each period, with the total as a line",
      ctx.trend.map((b) => b.label),
      [{ name: "New children", color: NV, values: newSpark }],
      { full: true, line: { name: "Children", color: BZ, values: activeSpark } },
    ),
  );

  const genders = countBy(activeChildren, (c) => {
    const g = String(c.user_info?.gender || "").trim().toLowerCase();
    return g === "male" ? "Male" : g === "female" ? "Female" : g ? "Other" : null;
  });
  const bands = countBy(activeChildren, (c) => ageBandOf(c, asOf));
  const modes = countBy(activeChildren, (c) =>
    c.membership_type === "IN_HOUSE" ? "In-house" : c.membership_type === "ONLINE" ? "Online" : null,
  );
  const noDob = activeChildren.filter((c) => !c.user_info?.date_of_birth).length;
  if (activeChildren.length) {
    sections.push(
      segments(
        "who",
        "Who they are",
        "All active children",
        [
          {
            label: "Gender",
            parts: [["Female", NV], ["Male", BZ], ["Other", GR]].map(([l, col]) => ({
              label: l,
              value: genders.get(l) || 0,
              color: col,
            })),
          },
          {
            label: "Age band",
            parts: AGE_BANDS.map((b) => ({ label: b.label, value: bands.get(b.label) || 0, color: b.color })),
          },
          {
            label: "How they attend",
            parts: [["In-house", NV], ["Online", BZ]].map(([l, col]) => ({
              label: l,
              value: modes.get(l) || 0,
              color: col,
            })),
          },
        ],
        {
          note: noDob
            ? `${plural(noDob, "child has", "children have")} no date of birth recorded and are left out of age bands.`
            : undefined,
        },
      ),
    );
  }

  const places = Array.from(countBy(activeChildren, placeOf).entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (places.length) {
    sections.push(
      hbars("places", "Top cities and regions", "Where active children live", places.map(([label, value]) => ({ label, value }))),
    );
  }

  // Birthdays in the window right after the period (at most a month).
  const span = Math.min(ctx.to.getTime() - ctx.from.getTime(), 31 * DAY);
  const bdFrom = ctx.to;
  const bdTo = new Date(ctx.to.getTime() + span);
  const birthdays = activeChildren
    .map((c) => {
      const dob = c.user_info?.date_of_birth;
      if (!dob) return null;
      for (const year of [bdFrom.getUTCFullYear(), bdFrom.getUTCFullYear() + 1]) {
        const day = new Date(Date.UTC(year, dob.getUTCMonth(), dob.getUTCDate()));
        if (day >= bdFrom && day < bdTo) return { c, day, turns: year - dob.getUTCFullYear() };
      }
      return null;
    })
    .filter((b): b is { c: Child; day: Date; turns: number } => !!b)
    .sort((a, b) => a.day.getTime() - b.day.getTime());
  const wholeMonth = ctx.periodType === "MONTHLY";
  const bdTitle = wholeMonth ? `Birthdays in ${MONTHS_LONG[bdFrom.getUTCMonth()]}` : "Upcoming birthdays";
  sections.push(
    list(
      "birthdays",
      bdTitle,
      wholeMonth
        ? "For pastoral care and celebration"
        : `${shortDate(bdFrom)} – ${shortDate(addDays(bdTo, -1))}, for pastoral care and celebration`,
      birthdays.slice(0, 5).map((b) => ({
        title: [b.c.user_info?.first_name, b.c.user_info?.last_name].filter(filled).join(" ") || b.c.name,
        sub: `${b.day.getUTCDate()} ${monthLabel(b.day)} · turns ${b.turns}`,
        pii: true,
      })),
      {
        note: birthdays.length
          ? `${plural(birthdays.length, "birthday", "birthdays")} in total. Full list in Membership.`
          : "No birthdays recorded for this window.",
      },
    ),
  );

  const incomplete = activeChildren.length - completeCount;
  sections.push(
    stats("data-health", "Data health", "Records to tidy up, as of today", [
      {
        label: "No emergency contact",
        value: nf(noEmergency),
        sub: `${Math.round(pctOf(noEmergency, activeChildren.length))}% of children`,
        color: noEmergency ? RD : MG,
      },
      {
        label: "Incomplete profiles",
        value: nf(incomplete),
        sub: `${Math.round(pctOf(incomplete, activeChildren.length))}% of children`,
        color: incomplete ? AM : MG,
      },
      {
        label: "No date of birth",
        value: nf(noDob),
        sub: noDob ? "Add so age bands are complete" : "All recorded",
        color: noDob ? AM : MG,
      },
    ]),
  );

  /* ---------------------------- Highlights ----------------------------- */
  const highlights: string[] = [];
  if (newChildren.length) {
    highlights.push(
      `${plural(newChildren.length, "child", "children")} joined in ${ctx.periodLabel}${changeWords(newChildren.length, prevNew, ctx.prev.label)}.`,
    );
  } else {
    highlights.push(`No children were added in ${ctx.periodLabel}.`);
  }
  const activeDiff = activeNow - activePrev;
  if (activeNow) {
    highlights.push(
      activeDiff === 0
        ? `The number of children held at ${nf(activeNow)}.`
        : `Children ${activeDiff > 0 ? "grew" : "fell"} by ${nf(Math.abs(activeDiff))} to ${nf(activeNow)} since ${ctx.prev.label}.`,
    );
  }
  const topBand = Array.from(bands.entries()).sort((a, b) => b[1] - a[1])[0];
  if (activeChildren.length >= 5 && topBand) {
    highlights.push(`${topBand[0]} is the largest age band, ${Math.round(pctOf(topBand[1], activeChildren.length))}% of children.`);
  }

  /* ----------------------------- By branch ----------------------------- */
  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "children",
      ["Children", "New", "No emergency contact"],
      ctx.branches.map((b) => {
        const rows = children.filter((c) => c.branch_id === b.id);
        const activeRows = rows.filter((c) => isActive(c) && existedBy(c, asOf));
        return {
          branch: b.name,
          values: [
            activeAt(rows, asOf),
            newIn(rows, range).length,
            activeRows.filter((c) => !c.user_info?.emergency_contact_id).length,
          ],
        };
      }),
    );
  }

  const body = emptyBody();
  body.kpis = kpis;
  body.flags = sortedFlags;
  body.highlights = highlights.slice(0, 4);
  body.sections = sections;
  body.by_branch = by_branch;
  body.headline = [0, 1];
  body.health = healthOf(sortedFlags);
  body.empty = activeNow === 0 && newChildren.length === 0;

  return {
    body,
    facts: {
      children: activeNow,
      new_children: newChildren.length,
      inactive_children: inactiveCount,
      children_without_emergency_contact: noEmergency,
      profiles_complete_pct: completePct,
    },
  };
};
