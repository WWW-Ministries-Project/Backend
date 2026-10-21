/**
 * Membership report.
 *
 * Definitions (shared with the member directory, user/memberDirectoryController):
 * - A member is a `user` row that is not a guest (`is_guest` false/null) and
 *   not an anonymised account ("Deleted User …").
 * - Active = `is_active` true or null. A member "joined" when their record was
 *   created (`created_at`).
 * - Stage as of a date: MEMBER once `functional_at` has passed, CONFIRMED once
 *   `confirmed_at` has passed, otherwise Unconfirmed. Legacy rows with a stage
 *   but no stamp count as reaching it when the record was created.
 * - Serving = holds a department position or has a department set.
 * - School of Ministry = LMS enrollments (open vs completed).
 * - Profile complete = date of birth, gender, phone, email, city or address,
 *   marital status and an emergency contact are all recorded.
 *
 * Dropped / adapted from the design mock (no data behind them):
 * - "Net growth" and "Inactive members rose by N": deactivation dates are not
 *   recorded, so nobody can be placed as "became inactive" in a period.
 *   Inactive members are a current count with no comparison, and the flag is
 *   raised on the inactive share instead.
 * - Active members for past periods use today's active flag for everyone
 *   whose record existed by then (same reason).
 * - "Profiles complete" has no history (profile edits are not versioned), so
 *   it is a current figure with no comparison or trend.
 * - Membership stages use the last stamp only: a member moved back to an
 *   earlier stage loses their stamp, so conversions can be undercounted.
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
  funnel,
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

const DAY = 86_400_000;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MEMBERS_PATH = "/home/membership";

const memberSelect = {
  id: true,
  name: true,
  email: true,
  created_at: true,
  is_active: true,
  status: true,
  confirmed_at: true,
  functional_at: true,
  membership_type: true,
  branch_id: true,
  department_id: true,
  source_visitor_id: true,
  source_soul_won_id: true,
  registration_source: true,
  soul_won_membership: { select: { id: true } },
  department_positions: { select: { start_date: true } },
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
      marital_status: true,
      emergency_contact_id: true,
    },
  },
} satisfies Prisma.userSelect;

type Member = Prisma.userGetPayload<{ select: typeof memberSelect }>;
type Range = { from: Date; to: Date };

const isActive = (m: Member) => m.is_active !== false;
const existedBy = (m: Member, at: Date) => m.created_at < at;
const activeAt = (members: Member[], at: Date) => members.filter((m) => isActive(m) && existedBy(m, at)).length;
const within = (d: Date | null | undefined, r: Range) => !!d && d >= r.from && d < r.to;

/** When the member reached CONFIRMED / MEMBER, falling back to created_at for legacy rows. */
const confirmedOn = (m: Member) =>
  m.confirmed_at ?? (m.status === "CONFIRMED" || m.status === "MEMBER" ? m.created_at : null);
const functionalOn = (m: Member) => m.functional_at ?? (m.status === "MEMBER" ? m.created_at : null);

const unconfirmedAt = (m: Member, at: Date) => {
  const confirmed = confirmedOn(m);
  const functional = functionalOn(m);
  return !(confirmed && confirmed <= at) && !(functional && functional <= at);
};

const newIn = (members: Member[], r: Range) => members.filter((m) => within(m.created_at, r));
const conversionsIn = (members: Member[], r: Range) => {
  const toConfirmed = members.filter((m) => within(m.confirmed_at, r)).length;
  const toMember = members.filter((m) => within(m.functional_at, r)).length;
  return { toConfirmed, toMember, total: toConfirmed + toMember };
};

const avgDays = (pairs: [Date, Date][]) =>
  pairs.length ? Math.round(pairs.reduce((a, [s, e]) => a + (e.getTime() - s.getTime()) / DAY, 0) / pairs.length) : null;

/** Average days from joining to MEMBER for people who reached MEMBER in the range. */
const daysToMember = (members: Member[], r: Range) =>
  avgDays(
    members
      .filter((m) => within(m.functional_at, r) && m.functional_at! >= m.created_at)
      .map((m) => [m.created_at, m.functional_at!] as [Date, Date]),
  );

const filled = (v: unknown) => v != null && String(v).trim() !== "";
const isProfileComplete = (m: Member) => {
  const info = m.user_info;
  if (!info) return false;
  return (
    filled(info.date_of_birth) &&
    filled(info.gender) &&
    filled(info.primary_number) &&
    (filled(info.email) || filled(m.email)) &&
    (filled(info.city) || filled(info.address)) &&
    filled(info.marital_status) &&
    filled(info.emergency_contact_id)
  );
};

const ageAt = (dob: Date, at: Date) => {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  return beforeBirthday ? age - 1 : age;
};

const AGE_GROUPS: { label: string; max: number; color: string }[] = [
  { label: "Children", max: 12, color: NV },
  { label: "Youth", max: 17, color: BZ },
  { label: "Young adults", max: 35, color: SF },
  { label: "Adults", max: 59, color: MG },
  { label: "Seniors", max: Infinity, color: GR },
];
const ageGroupOf = (m: Member, at: Date) => {
  const dob = m.user_info?.date_of_birth;
  if (!dob) return null;
  const age = ageAt(dob, at);
  return AGE_GROUPS.find((g) => age <= g.max)?.label ?? null;
};

const countBy = <T>(items: T[], keyOf: (item: T) => string | null) => {
  const out = new Map<string, number>();
  items.forEach((item) => {
    const key = keyOf(item);
    if (key) out.set(key, (out.get(key) || 0) + 1);
  });
  return out;
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const isGhana = (country: string | null | undefined) => !filled(country) || /^(gh|gha)$|ghana/i.test(String(country).trim());
const placeOf = (m: Member) => {
  const info = m.user_info;
  if (!info) return null;
  if (!isGhana(info.country)) return "Outside Ghana";
  return filled(info.city) ? titleCase(String(info.city).trim()) : null;
};

/** Records that share a name and a phone number, email or date of birth with another record. */
const possibleDuplicates = (members: Member[]) => {
  const groups = new Map<string, number[]>();
  const add = (key: string, id: number) => groups.set(key, [...(groups.get(key) || []), id]);
  members.forEach((m) => {
    const name = m.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!name) return;
    const phone = (m.user_info?.primary_number || "").replace(/\D/g, "").slice(-9);
    const email = (m.user_info?.email || m.email || "").trim().toLowerCase();
    const dob = m.user_info?.date_of_birth?.toISOString().slice(0, 10);
    if (phone.length >= 7) add(`${name}|p|${phone}`, m.id);
    if (email) add(`${name}|e|${email}`, m.id);
    if (dob) add(`${name}|d|${dob}`, m.id);
  });
  const ids = new Set<number>();
  groups.forEach((list) => {
    if (list.length > 1) list.forEach((id) => ids.add(id));
  });
  return ids.size;
};

const plural = (n: number, one: string, many: string) => `${nf(n)} ${n === 1 ? one : many}`;

export const buildMembership: ReportBuilder = async (ctx) => {
  const branchWhere = getBranchScopedWhere(ctx.branchId);
  const memberWhere: Prisma.userWhereInput = {
    AND: [
      branchWhere || {},
      { OR: [{ is_guest: false }, { is_guest: null }] },
      { NOT: { name: { startsWith: "Deleted User" } } },
    ],
  };
  const range: Range = { from: ctx.from, to: ctx.to };
  // Stock figures are "as of" the period end, never later than today.
  const asOf = ctx.to < ctx.now ? ctx.to : ctx.now;

  const [members, visitorsInPeriod, enrollments] = await Promise.all([
    prisma.user.findMany({ where: memberWhere, select: memberSelect }),
    prisma.visitor.count({
      where: { ...(branchWhere || {}), visitDate: { gte: ctx.from, lt: ctx.to } },
    }),
    prisma.enrollment.findMany({
      where: { user: { AND: [memberWhere, { OR: [{ is_active: true }, { is_active: null }] }] } },
      select: { user_id: true, completed: true },
    }),
  ]);

  const newMembers = newIn(members, range);
  const joinRequests = newMembers.length
    ? await prisma.department_join_request.findMany({
        where: { status: "APPROVED", user_id: { in: newMembers.map((m) => m.id) } },
        select: { user_id: true, decided_at: true, start_date: true },
      })
    : [];

  /* ------------------------------- KPIs -------------------------------- */
  const activeNow = activeAt(members, asOf);
  const activePrev = activeAt(members, ctx.prev.to);
  const activeYoy = activeAt(members, ctx.yoy.to);
  const activeSpark = ctx.trend.map((b) => activeAt(members, b.to < ctx.now ? b.to : ctx.now));

  const prevNew = newIn(members, ctx.prev).length;
  const yoyNew = newIn(members, ctx.yoy).length;
  const newSpark = perBucket(members, ctx.trend, (m) => m.created_at);

  const conv = conversionsIn(members, range);
  const convPrev = conversionsIn(members, ctx.prev).total;
  const convYoy = conversionsIn(members, ctx.yoy).total;
  const convSpark = ctx.trend.map((b) => conversionsIn(members, b).total);

  const activeMembers = members.filter((m) => isActive(m) && existedBy(m, asOf));
  const inactiveCount = members.filter((m) => !isActive(m)).length;
  const completeCount = activeMembers.filter(isProfileComplete).length;
  const completePct = activeMembers.length ? round1(pctOf(completeCount, activeMembers.length)) : null;

  const kpis = [
    kpi("active_members", "Active members", activeNow, {
      prev: activePrev,
      yoy: activeYoy,
      spark: activeSpark,
    }),
    kpi("new_members", "New members", newMembers.length, { prev: prevNew, yoy: yoyNew, spark: newSpark }),
    kpi("stage_conversions", "Stage conversions", conv.total, {
      prev: convPrev,
      yoy: convYoy,
      spark: convSpark,
      sub: `${nf(conv.toConfirmed)} to Confirmed · ${nf(conv.toMember)} to Member`,
    }),
    kpi("inactive_members", "Inactive members", inactiveCount, {
      good: "down",
      sub: "Current count. Deactivation dates are not recorded.",
    }),
    kpi("profiles_complete", "Profiles complete", completePct, {
      format: "pct",
      sub: activeMembers.length ? `${nf(completeCount)} of ${nf(activeMembers.length)} active members today` : null,
    }),
  ];

  /* ------------------------------- Flags ------------------------------- */
  const cutoff = new Date(asOf.getTime() - 90 * DAY);
  const staleUnconfirmed = activeMembers.filter((m) => m.created_at < cutoff && unconfirmedAt(m, asOf)).length;
  const noEmergency = activeMembers.filter((m) => !m.user_info?.emergency_contact_id).length;
  const totalOnRoll = activeMembers.length + inactiveCount;
  const inactiveShare = pctOf(inactiveCount, totalOnRoll);

  const flags: FlagDTO[] = [];
  if (staleUnconfirmed > 0) {
    flags.push(
      flag(
        staleUnconfirmed >= 10 ? "act" : "watch",
        `${plural(staleUnconfirmed, "person has", "people have")} been Unconfirmed for more than 90 days`,
        `View ${plural(staleUnconfirmed, "person", "people")}`,
        `${MEMBERS_PATH}?status=UNCONFIRMED&sort=oldest`,
      ),
    );
  }
  if (prevNew >= 4 && newMembers.length <= prevNew * 0.75) {
    flags.push(
      flag(
        "watch",
        `New members fell by ${Math.round((1 - newMembers.length / prevNew) * 100)}% to ${nf(newMembers.length)}, from ${nf(prevNew)} in ${ctx.prev.label}`,
        "View newest members",
        `${MEMBERS_PATH}?sort=newest`,
      ),
    );
  }
  if (inactiveCount > 0 && inactiveShare >= 10) {
    flags.push(
      flag(
        "watch",
        `${plural(inactiveCount, "member is", "members are")} marked inactive, ${Math.round(inactiveShare)}% of the register`,
        "View inactive members",
        `${MEMBERS_PATH}?status=INACTIVE`,
      ),
    );
  }
  if (noEmergency > 0 && pctOf(noEmergency, activeMembers.length) >= 5) {
    flags.push(flag("watch", `${plural(noEmergency, "member has", "members have")} no emergency contact`));
  }
  if (completePct != null && completePct < 60) {
    flags.push(flag("watch", `Only ${Math.round(completePct)}% of member profiles are complete`));
  }
  const sortedFlags = sortFlags(flags);

  /* ----------------------------- Sections ------------------------------ */
  const sections: SectionDTO[] = [];

  sections.push(
    bars(
      "growth",
      "Growth trend",
      "New members in each period, with active membership as a line",
      ctx.trend.map((b) => b.label),
      [{ name: "New members", color: NV, values: newSpark }],
      { full: true, line: { name: "Active members", color: BZ, values: activeSpark } },
    ),
  );

  const reachedConfirmed = members.filter((m) => within(m.confirmed_at, range));
  const reachedMember = members.filter((m) => within(m.functional_at, range));
  const daysUnconfirmed = avgDays(
    reachedConfirmed.filter((m) => m.confirmed_at! >= m.created_at).map((m) => [m.created_at, m.confirmed_at!] as [Date, Date]),
  );
  const daysConfirmed = avgDays(
    reachedMember
      .filter((m) => m.confirmed_at && m.functional_at! >= m.confirmed_at)
      .map((m) => [m.confirmed_at!, m.functional_at!] as [Date, Date]),
  );
  sections.push(
    funnel("funnel", "Membership funnel", "How people moved through each stage in the period", [
      { label: "First-time visitors", value: visitorsInPeriod },
      { label: "New members (Unconfirmed)", value: newMembers.length },
      {
        label: "Reached Confirmed",
        value: reachedConfirmed.length,
        note: daysUnconfirmed != null ? `${nf(daysUnconfirmed)} days from joining on average` : undefined,
      },
      {
        label: "Reached Member",
        value: reachedMember.length,
        note: daysConfirmed != null ? `${nf(daysConfirmed)} days after Confirmed on average` : undefined,
      },
    ]),
  );

  const fromVisitors = newMembers.filter((m) => m.source_visitor_id != null).length;
  const fromSouls = newMembers.filter(
    (m) => m.source_visitor_id == null && (m.source_soul_won_id != null || m.soul_won_membership != null),
  ).length;
  const fromApp = newMembers.filter(
    (m) => m.source_visitor_id == null && m.source_soul_won_id == null && !m.soul_won_membership && m.registration_source === "MOBILE_APP",
  ).length;
  const direct = newMembers.length - fromVisitors - fromSouls - fromApp;
  if (newMembers.length) {
    sections.push(
      hbars(
        "sources",
        "Where new members came from",
        `Source of the ${plural(newMembers.length, "person", "people")} who joined`,
        [
          { label: "Converted visitors", value: fromVisitors },
          { label: "Souls won in life centers", value: fromSouls },
          { label: "Signed up on the app", value: fromApp },
          { label: "Registered directly", value: direct },
        ].filter((r) => r.value > 0),
      ),
    );
  }

  const genders = countBy(activeMembers, (m) => {
    const g = String(m.user_info?.gender || "").trim().toLowerCase();
    return g === "male" ? "Male" : g === "female" ? "Female" : g ? "Other" : null;
  });
  const ages = countBy(activeMembers, (m) => ageGroupOf(m, asOf));
  const marital = countBy(activeMembers, (m) => {
    const s = m.user_info?.marital_status;
    if (!s) return null;
    return s === "MARRIED" ? "Married" : s === "SINGLE" ? "Single" : s === "DIVORCED" ? "Divorced" : "Widowed";
  });
  const modes = countBy(activeMembers, (m) =>
    m.membership_type === "IN_HOUSE" ? "In-house" : m.membership_type === "ONLINE" ? "Online" : null,
  );
  const noDob = activeMembers.filter((m) => !m.user_info?.date_of_birth).length;
  if (activeMembers.length) {
    sections.push(
      segments(
        "who",
        "Who we are",
        "All active members",
        [
          { label: "Gender", parts: [["Female", NV], ["Male", BZ], ["Other", GR]].map(([l, c]) => ({ label: l, value: genders.get(l) || 0, color: c })) },
          { label: "Age group", parts: AGE_GROUPS.map((g) => ({ label: g.label, value: ages.get(g.label) || 0, color: g.color })) },
          {
            label: "Marital status",
            parts: [["Married", NV], ["Single", BZ], ["Widowed", SF], ["Divorced", MG]].map(([l, c]) => ({ label: l, value: marital.get(l) || 0, color: c })),
          },
          { label: "How they attend", parts: [["In-house", NV], ["Online", BZ]].map(([l, c]) => ({ label: l, value: modes.get(l) || 0, color: c })) },
        ],
        { note: noDob ? `${plural(noDob, "member has", "members have")} no date of birth recorded and are left out of age groups.` : undefined },
      ),
    );
  }

  const places = Array.from(countBy(activeMembers, placeOf).entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (places.length) {
    sections.push(
      hbars("places", "Top cities and regions", "Where active members live", places.map(([label, value]) => ({ label, value }))),
    );
  }

  const activeIds = new Set(activeMembers.map((m) => m.id));
  const serving = activeMembers.filter((m) => m.department_positions.length > 0 || m.department_id != null).length;
  const enrolledOpen = new Set<number>();
  const completedAny = new Set<number>();
  enrollments.forEach((e) => {
    if (e.user_id == null || !activeIds.has(e.user_id)) return;
    (e.completed ? completedAny : enrolledOpen).add(e.user_id);
  });
  if (activeMembers.length) {
    sections.push(
      stats("ministry", "Ministry involvement", "Active members serving and learning, as of today", [
        { label: "Serving in a department", value: `${Math.round(pctOf(serving, activeMembers.length))}%`, sub: plural(serving, "member", "members") },
        { label: "In a School of Ministry programme", value: `${Math.round(pctOf(enrolledOpen.size, activeMembers.length))}%`, sub: `${nf(enrolledOpen.size)} enrolled` },
        { label: "Completed a programme", value: `${Math.round(pctOf(completedAny.size, activeMembers.length))}%`, sub: plural(completedAny.size, "member", "members") },
      ]),
    );
  }

  // Birthdays in the window right after the period (at most a month).
  const span = Math.min(ctx.to.getTime() - ctx.from.getTime(), 31 * DAY);
  const bdFrom = ctx.to;
  const bdTo = new Date(ctx.to.getTime() + span);
  const birthdays = activeMembers
    .map((m) => {
      const dob = m.user_info?.date_of_birth;
      if (!dob) return null;
      for (const year of [bdFrom.getUTCFullYear(), bdFrom.getUTCFullYear() + 1]) {
        const day = new Date(Date.UTC(year, dob.getUTCMonth(), dob.getUTCDate()));
        if (day >= bdFrom && day < bdTo) return { m, day, turns: year - dob.getUTCFullYear() };
      }
      return null;
    })
    .filter((b): b is { m: Member; day: Date; turns: number } => !!b)
    .sort((a, b) => a.day.getTime() - b.day.getTime());
  const wholeMonth = ctx.periodType === "MONTHLY";
  const bdTitle = wholeMonth ? `Birthdays in ${MONTHS_LONG[bdFrom.getUTCMonth()]}` : "Upcoming birthdays";
  sections.push(
    list(
      "birthdays",
      bdTitle,
      wholeMonth ? "For pastoral care and celebration" : `${shortDate(bdFrom)} – ${shortDate(addDays(bdTo, -1))}, for pastoral care and celebration`,
      birthdays.slice(0, 5).map((b) => ({
        title: [b.m.user_info?.first_name, b.m.user_info?.last_name].filter(filled).join(" ") || b.m.name,
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

  const incomplete = activeMembers.length - completeCount;
  const duplicates = possibleDuplicates(activeMembers);
  sections.push(
    stats("data-health", "Data health", "Records to tidy up, as of today", [
      { label: "No emergency contact", value: nf(noEmergency), sub: `${Math.round(pctOf(noEmergency, activeMembers.length))}% of members`, color: noEmergency ? AM : MG },
      { label: "Incomplete profiles", value: nf(incomplete), sub: `${Math.round(pctOf(incomplete, activeMembers.length))}% of members`, color: incomplete ? AM : MG },
      { label: "Possible duplicates", value: nf(duplicates), sub: duplicates ? "Review and merge" : "None found", color: duplicates ? RD : MG },
    ]),
  );

  /* ---------------------------- Highlights ----------------------------- */
  const highlights: string[] = [];
  if (newMembers.length) {
    highlights.push(
      `${plural(newMembers.length, "new member", "new members")} joined in ${ctx.periodLabel}${changeWords(newMembers.length, prevNew, ctx.prev.label)}.` +
        (fromVisitors ? ` ${nf(fromVisitors)} of them started as visitors.` : ""),
    );
  } else {
    highlights.push(`No new members were added in ${ctx.periodLabel}.`);
  }
  const activeDiff = activeNow - activePrev;
  if (activeNow) {
    highlights.push(
      activeDiff === 0
        ? `Active membership held at ${nf(activeNow)}.`
        : `Active membership ${activeDiff > 0 ? "grew" : "fell"} by ${nf(Math.abs(activeDiff))} to ${nf(activeNow)} since ${ctx.prev.label}.`,
    );
  }
  const newAges = countBy(newMembers, (m) => ageGroupOf(m, asOf));
  const topAge = Array.from(newAges.entries()).sort((a, b) => b[1] - a[1])[0];
  if (newMembers.length >= 5 && topAge) {
    highlights.push(`${topAge[0]} made up ${Math.round(pctOf(topAge[1], newMembers.length))}% of new members, the largest age group.`);
  }
  const toMemberNow = daysToMember(members, range);
  const toMemberPrev = daysToMember(members, ctx.prev);
  if (toMemberNow != null) {
    highlights.push(
      `People took ${plural(toMemberNow, "day", "days")} on average to move from joining to Member` +
        (toMemberPrev != null && toMemberPrev !== toMemberNow ? `, ${toMemberNow < toMemberPrev ? "down" : "up"} from ${nf(toMemberPrev)}.` : "."),
    );
  }

  /* ----------------------------- By branch ----------------------------- */
  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "membership",
      ["Members", "New", "Conversions", "Inactive"],
      ctx.branches.map((b) => {
        const rows = members.filter((m) => m.branch_id === b.id);
        return {
          branch: b.name,
          values: [activeAt(rows, asOf), newIn(rows, range).length, conversionsIn(rows, range).total, rows.filter((m) => !isActive(m)).length],
        };
      }),
    );
  }

  /* ------------------------------- Facts ------------------------------- */
  // A new member is "serving" when they got a department place within 90 days.
  const joinDates = new Map<number, Date>();
  const noteJoin = (userId: number, d: Date | null | undefined) => {
    if (!d) return;
    const prev = joinDates.get(userId);
    if (!prev || d < prev) joinDates.set(userId, d);
  };
  joinRequests.forEach((r) => noteJoin(r.user_id, r.start_date ?? r.decided_at));
  newMembers.forEach((m) => m.department_positions.forEach((p) => noteJoin(m.id, p.start_date)));
  const servingNew = newMembers.filter((m) => {
    const joined = joinDates.get(m.id);
    return !!joined && joined.getTime() <= m.created_at.getTime() + 90 * DAY;
  }).length;

  const body = emptyBody();
  body.kpis = kpis;
  body.flags = sortedFlags;
  body.highlights = highlights.slice(0, 4);
  body.sections = sections;
  body.by_branch = by_branch;
  body.headline = [0, 1];
  body.health = healthOf(sortedFlags);
  body.empty = activeNow === 0 && newMembers.length === 0 && conv.total === 0 && visitorsInPeriod === 0;

  return {
    body,
    facts: {
      active_members: activeNow,
      new_members: newMembers.length,
      serving_new_members: servingNew,
      stage_conversions: conv.total,
      inactive_members: inactiveCount,
      unconfirmed_over_90_days: staleUnconfirmed,
      profiles_complete_pct: completePct,
    },
  };
};
