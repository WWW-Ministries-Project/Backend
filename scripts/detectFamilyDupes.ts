// READ-ONLY detector for fuzzy duplicate children.
//
// The exact dedupe (scripts/dedupeChildren.ts) catches children with an
// identical first+last name AND date of birth. A harder class exists: the same
// child entered separately by each parent, with DIFFERENT spellings and/or
// swapped dates (e.g. "Berimah" 2012-12-06 under the father vs "Barimah"
// 2012-06-12 under the mother). The two copies are linked to different parents
// and share no family edge, so no exact key and no spouse-pair walk finds them.
//
// Signal: two child records whose NAMES are similar AND whose DATES OF BIRTH
// match, are day/month swapped, or at least share a year. This is fuzzy, so the
// script ONLY REPORTS candidates with evidence (names, DOBs, parents) — it never
// writes. A human confirms, then scripts/mergeChildPair.ts merges the pair.
//
//   npx ts-node --transpile-only scripts/detectFamilyDupes.ts
//   # or: npm run detect:family-dupes
import "dotenv/config";
import { prisma } from "../src/Models/context";
import { FAMILY_RELATION } from "../src/modules/user/familyRelations";

const norm = (s?: string | null) =>
  (s || "").trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ");
const tokens = (s?: string | null) => norm(s).split(/[\s-]+/).filter(Boolean);

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const simRatio = (a: string, b: string) => 1 - lev(a, b) / (Math.max(a.length, b.length) || 1);
// Order-independent: compare sorted token joins.
const nameSim = (a: string, b: string) => simRatio(tokens(a).sort().join(" "), tokens(b).sort().join(" "));
const firstTokenClose = (a: string, b: string) => {
  const ta = tokens(a)[0] || "", tb = tokens(b)[0] || "";
  return !!ta && !!tb && lev(ta, tb) <= 1;
};

const iso = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
function dobRelation(a?: Date | null, b?: Date | null): string {
  const ai = iso(a), bi = iso(b);
  if (!ai || !bi) return "one-missing";
  if (ai === bi) return "exact";
  const [ay, am, ad] = ai.split("-"), [by, bm, bd] = bi.split("-");
  if (ay === by && am === bd && ad === bm) return "day-month-swapped";
  if (ay === by) return "same-year";
  return "different";
}

async function childUserIds(): Promise<Set<number>> {
  const [a, b] = await Promise.all([
    prisma.family_relation.findMany({ where: { relation: FAMILY_RELATION.CHILD }, select: { family_id: true } }),
    prisma.family_relation.findMany({ where: { relation: FAMILY_RELATION.PARENT }, select: { user_id: true } }),
  ]);
  const s = new Set<number>(); a.forEach((e) => s.add(e.family_id)); b.forEach((e) => s.add(e.user_id));
  return s;
}
async function parentsOf(id: number): Promise<number[]> {
  const [a, b] = await Promise.all([
    prisma.family_relation.findMany({ where: { family_id: id, relation: FAMILY_RELATION.CHILD }, select: { user_id: true } }),
    prisma.family_relation.findMany({ where: { user_id: id, relation: FAMILY_RELATION.PARENT }, select: { family_id: true } }),
  ]);
  const s = new Set<number>(); a.forEach((e) => s.add(e.user_id)); b.forEach((e) => s.add(e.family_id));
  return [...s];
}

async function main() {
  const ids = [...(await childUserIds())];
  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, is_user: true, user_info: { select: { date_of_birth: true } } },
    orderBy: { id: "asc" },
  });
  const kids = rows.map((r) => ({ id: r.id, name: r.name || `#${r.id}`, dob: r.user_info?.date_of_birth ?? null, is_user: r.is_user }));

  const parentCache = new Map<number, number[]>();
  const getParents = async (id: number) => {
    if (!parentCache.has(id)) parentCache.set(id, await parentsOf(id));
    return parentCache.get(id)!;
  };
  const nameById = new Map(rows.map((r) => [r.id, r.name || `#${r.id}`]));
  const parentName = async (id: number) => {
    if (!nameById.has(id)) {
      const u = await prisma.user.findUnique({ where: { id }, select: { name: true } });
      nameById.set(id, u?.name || `#${id}`);
    }
    return nameById.get(id)!;
  };

  const candidates: any[] = [];
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const x = kids[i], y = kids[j];
      const score = nameSim(x.name, y.name);
      const firstClose = firstTokenClose(x.name, y.name);
      const dob = dobRelation(x.dob, y.dob);
      const strongDob = dob === "exact" || dob === "day-month-swapped";
      // Fuzzy pair: similar names AND a plausible DOB link. Require either a
      // strong DOB (exact/swapped) with decent name match, OR a very close name
      // with the same birth year.
      const match =
        (strongDob && (score >= 0.6 || firstClose)) ||
        (dob === "same-year" && (score >= 0.8 || (firstClose && score >= 0.6)));
      if (!match) continue;

      const [px, py] = await Promise.all([getParents(x.id), getParents(y.id)]);
      const sharedParent = px.some((p) => py.includes(p));
      const pxn = await Promise.all(px.map(parentName));
      const pyn = await Promise.all(py.map(parentName));
      candidates.push({
        score: Number(score.toFixed(2)), firstClose, dob, sharedParent,
        x: { id: x.id, name: x.name, dob: iso(x.dob), is_user: x.is_user, parents: pxn },
        y: { id: y.id, name: y.name, dob: iso(y.dob), is_user: y.is_user, parents: pyn },
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  console.log(`\nChildren scanned: ${kids.length}. Fuzzy duplicate candidates: ${candidates.length}\n`);
  for (const c of candidates) {
    console.log(
      `[name:${c.score}${c.firstClose ? " first~" : ""} dob:${c.dob}${c.sharedParent ? " SHARED-PARENT" : ""}]`,
    );
    console.log(`   keep? #${c.x.id} "${c.x.name}" (${c.x.dob})  parents: ${c.x.parents.join(", ") || "none"}${c.x.is_user ? " *LOGIN*" : ""}`);
    console.log(`   dup?  #${c.y.id} "${c.y.name}" (${c.y.dob})  parents: ${c.y.parents.join(", ") || "none"}${c.y.is_user ? " *LOGIN*" : ""}`);
  }
  console.log(`\nREAD-ONLY. Confirmed pairs → scripts/mergeChildPair.ts <keepId> <removeId>.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
