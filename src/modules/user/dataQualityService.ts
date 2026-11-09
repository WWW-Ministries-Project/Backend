// Data-quality service: find and resolve duplicate child records.
//
// Two classes of duplicate exist, both created when a child is entered by more
// than one parent in separate registrations:
//   - EXACT: identical first+last name AND date of birth.
//   - FUZZY: same child, different spelling and/or swapped/near date of birth
//     (e.g. "Berimah" 2012-12-06 vs "Barimah" 2012-06-12).
// Each copy links to a different parent, so neither the per-family match in
// saveFamily nor an exact key reliably finds the fuzzy ones.
//
// This module powers the Data Quality admin page: `findDuplicateChildCandidates`
// lists candidate pairs with evidence; `mergeChildRecords` unifies one confirmed
// pair — re-pointing every family_relation edge from the removed record onto the
// kept one (so the child ends up linked to BOTH parents) and deleting the copy.
import { prisma } from "../../Models/context";
import { FAMILY_RELATION } from "./familyRelations";

const norm = (s?: string | null) =>
  (s || "").trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ");
const nameTokens = (s?: string | null) => norm(s).split(/[\s-]+/).filter(Boolean);

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}
const simRatio = (a: string, b: string) =>
  1 - levenshtein(a, b) / (Math.max(a.length, b.length) || 1);
// Order-independent name similarity (handles reordered middle names).
const nameSimilarity = (a: string, b: string) =>
  simRatio(nameTokens(a).sort().join(" "), nameTokens(b).sort().join(" "));
const firstNameClose = (a: string, b: string) => {
  const ta = nameTokens(a)[0] || "", tb = nameTokens(b)[0] || "";
  return !!ta && !!tb && levenshtein(ta, tb) <= 1;
};

const isoDate = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
export type DobRelation =
  | "exact" | "day-month-swapped" | "same-year" | "different" | "one-missing";
function dobRelation(a?: Date | null, b?: Date | null): DobRelation {
  const ai = isoDate(a), bi = isoDate(b);
  if (!ai || !bi) return "one-missing";
  if (ai === bi) return "exact";
  const [ay, am, ad] = ai.split("-");
  const [by, bm, bd] = bi.split("-");
  if (ay === by && am === bd && ad === bm) return "day-month-swapped";
  if (ay === by) return "same-year";
  return "different";
}

async function childUserIds(): Promise<number[]> {
  const [asChild, asParentLink] = await Promise.all([
    prisma.family_relation.findMany({
      where: { relation: FAMILY_RELATION.CHILD },
      select: { family_id: true },
    }),
    prisma.family_relation.findMany({
      where: { relation: FAMILY_RELATION.PARENT },
      select: { user_id: true },
    }),
  ]);
  const ids = new Set<number>();
  asChild.forEach((e) => ids.add(e.family_id));
  asParentLink.forEach((e) => ids.add(e.user_id));
  return [...ids];
}

async function parentIdsOf(id: number): Promise<number[]> {
  const [a, b] = await Promise.all([
    prisma.family_relation.findMany({
      where: { family_id: id, relation: FAMILY_RELATION.CHILD },
      select: { user_id: true },
    }),
    prisma.family_relation.findMany({
      where: { user_id: id, relation: FAMILY_RELATION.PARENT },
      select: { family_id: true },
    }),
  ]);
  const s = new Set<number>();
  a.forEach((e) => s.add(e.user_id));
  b.forEach((e) => s.add(e.family_id));
  return [...s];
}

export type DuplicatePerson = {
  id: number;
  name: string;
  date_of_birth: string | null;
  is_user: boolean;
  member_id: string | null;
  parents: { id: number; name: string }[];
};

export type DuplicateCandidate = {
  match_type: "exact" | "fuzzy";
  name_score: number;
  first_name_close: boolean;
  dob_relation: DobRelation;
  shared_parent: boolean; // true = likely twins / same family already — review carefully
  // suggested keeper (lowest id) / record to remove — the UI lets the user flip this
  suggested_keep_id: number;
  suggested_remove_id: number;
  records: [DuplicatePerson, DuplicatePerson];
};

/**
 * All candidate duplicate child pairs, most-confident first. Read-only.
 * `match_type` is "exact" when name + DOB are identical, else "fuzzy".
 * `shared_parent` flags pairs under the same parent with different first names
 * (likely twins) so the UI can warn instead of merging blindly.
 */
export async function findDuplicateChildCandidates(): Promise<DuplicateCandidate[]> {
  const ids = await childUserIds();
  if (ids.length < 2) return [];

  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      is_user: true,
      member_id: true,
      user_info: { select: { first_name: true, last_name: true, date_of_birth: true } },
    },
    orderBy: { id: "asc" },
  });

  const kids = rows.map((r) => ({
    id: r.id,
    name: r.name || `#${r.id}`,
    first: r.user_info?.first_name ?? null,
    last: r.user_info?.last_name ?? null,
    dob: r.user_info?.date_of_birth ?? null,
    is_user: !!r.is_user,
    member_id: r.member_id ?? null,
  }));

  const parentCache = new Map<number, number[]>();
  const getParents = async (id: number) => {
    if (!parentCache.has(id)) parentCache.set(id, await parentIdsOf(id));
    return parentCache.get(id)!;
  };
  const nameById = new Map(rows.map((r) => [r.id, r.name || `#${r.id}`]));
  const ensureName = async (id: number) => {
    if (!nameById.has(id)) {
      const u = await prisma.user.findUnique({ where: { id }, select: { name: true } });
      nameById.set(id, u?.name || `#${id}`);
    }
    return nameById.get(id)!;
  };
  const toPerson = async (k: (typeof kids)[number]): Promise<DuplicatePerson> => {
    const ps = await getParents(k.id);
    const names = await Promise.all(ps.map(ensureName));
    return {
      id: k.id,
      name: k.name,
      date_of_birth: isoDate(k.dob),
      is_user: k.is_user,
      member_id: k.member_id,
      parents: ps.map((id, i) => ({ id, name: names[i] })),
    };
  };

  const out: DuplicateCandidate[] = [];
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const x = kids[i], y = kids[j];
      const score = nameSimilarity(x.name, y.name);
      const firstClose = firstNameClose(x.name, y.name);
      const dob = dobRelation(x.dob, y.dob);
      const strongDob = dob === "exact" || dob === "day-month-swapped";

      const exact =
        norm(x.first) === norm(y.first) &&
        norm(x.last) === norm(y.last) &&
        dob === "exact" &&
        !!x.dob;

      const fuzzy =
        !exact &&
        ((strongDob && (score >= 0.6 || firstClose)) ||
          (dob === "same-year" && (score >= 0.8 || (firstClose && score >= 0.6))));

      if (!exact && !fuzzy) continue;

      const [px, py] = await Promise.all([getParents(x.id), getParents(y.id)]);
      const sharedParent = px.some((p) => py.includes(p));

      out.push({
        match_type: exact ? "exact" : "fuzzy",
        name_score: Number(score.toFixed(2)),
        first_name_close: firstClose,
        dob_relation: dob,
        shared_parent: sharedParent,
        suggested_keep_id: Math.min(x.id, y.id),
        suggested_remove_id: Math.max(x.id, y.id),
        records: [await toPerson(x), await toPerson(y)],
      });
    }
  }

  // Exact matches first, then by name confidence.
  out.sort((a, b) => {
    if (a.match_type !== b.match_type) return a.match_type === "exact" ? -1 : 1;
    return b.name_score - a.name_score;
  });
  return out;
}

export type MergeResult = {
  kept_id: number;
  removed_id: number;
  edges_repointed: number;
};

/**
 * Merge a confirmed duplicate pair: re-point every family_relation edge from
 * `removeId` onto `keepId` (so the kept child gains the removed copy's parent),
 * then delete the removed record's user_info and user row. One transaction, so a
 * foreign-key reference elsewhere rolls the whole merge back.
 *
 * Refuses to remove a login account (is_user = true) — merge the other way.
 * The kept record retains its own name and date of birth.
 */
export async function mergeChildRecords(
  keepId: number,
  removeId: number,
): Promise<MergeResult> {
  if (!Number.isInteger(keepId) || !Number.isInteger(removeId)) {
    throw new Error("keepId and removeId must be integers.");
  }
  if (keepId === removeId) {
    throw new Error("keepId and removeId must be different.");
  }

  const [keep, remove] = await Promise.all([
    prisma.user.findUnique({ where: { id: keepId }, select: { id: true, is_user: true } }),
    prisma.user.findUnique({ where: { id: removeId }, select: { id: true, is_user: true } }),
  ]);
  if (!keep) throw new Error(`Record to keep (#${keepId}) not found.`);
  if (!remove) throw new Error(`Record to remove (#${removeId}) not found.`);
  if (remove.is_user) {
    throw new Error(
      `Record #${removeId} is a login account and cannot be removed. Swap which record you keep.`,
    );
  }

  const edges = await prisma.family_relation.findMany({
    where: { OR: [{ user_id: removeId }, { family_id: removeId }] },
    select: { user_id: true, family_id: true, relation: true },
  });

  const ops: any[] = [];
  let repointed = 0;
  for (const e of edges) {
    const nu = e.user_id === removeId ? keepId : e.user_id;
    const nf = e.family_id === removeId ? keepId : e.family_id;
    if (nu === nf) continue; // the two copies were linked to each other — just drop it
    repointed++;
    ops.push(
      prisma.family_relation.upsert({
        where: { user_id_family_id: { user_id: nu, family_id: nf } },
        update: { relation: e.relation },
        create: { user_id: nu, family_id: nf, relation: e.relation },
      }),
    );
  }
  ops.push(
    prisma.family_relation.deleteMany({
      where: { OR: [{ user_id: removeId }, { family_id: removeId }] },
    }),
  );
  ops.push(prisma.user_info.deleteMany({ where: { user_id: removeId } }));
  ops.push(prisma.user.delete({ where: { id: removeId } }));

  await prisma.$transaction(ops);
  return { kept_id: keepId, removed_id: removeId, edges_repointed: repointed };
}
