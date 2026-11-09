// Merge ONE confirmed duplicate child pair, unifying the family.
//
// Use for fuzzy duplicates that the exact dedupe (scripts/dedupeChildren.ts)
// cannot match — the same child entered by each parent with different spellings
// or swapped dates (found via scripts/detectFamilyDupes.ts). Each copy is linked
// to a different parent; merging re-points EVERY family_relation edge from the
// removed record onto the kept one, so the kept child ends up linked to BOTH
// parents (the family is unified), then deletes the removed record.
//
// The keeper RETAINS ITS OWN name and date of birth. When the two copies
// disagree (e.g. a swapped DOB), the keeper's values win — fix them by hand
// afterwards if the other copy was the correct one. Pick the keeper id with that
// in mind.
//
//   npx ts-node --transpile-only scripts/mergeChildPair.ts <keepId> <removeId>           # dry run
//   npx ts-node --transpile-only scripts/mergeChildPair.ts <keepId> <removeId> --apply   # execute
//   # or: npm run merge:child-pair -- <keepId> <removeId> [--apply]
import "dotenv/config";
import { prisma } from "../src/Models/context";
import { FAMILY_RELATION } from "../src/modules/user/familyRelations";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const keepId = Number(args[0]);
const removeId = Number(args[1]);

async function describe(id: number) {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, is_user: true,
      user_info: { select: { first_name: true, last_name: true, date_of_birth: true } },
    },
  });
  if (!u) return null;
  const edges = await prisma.family_relation.findMany({
    where: { OR: [{ user_id: id }, { family_id: id }] },
    select: { user_id: true, family_id: true, relation: true },
  });
  const otherIds = new Set<number>();
  edges.forEach((e) => otherIds.add(e.user_id === id ? e.family_id : e.user_id));
  const others = await prisma.user.findMany({ where: { id: { in: [...otherIds] } }, select: { id: true, name: true } });
  const nameOf = new Map(others.map((o) => [o.id, o.name || `#${o.id}`]));
  return {
    id: u.id, name: u.name, is_user: u.is_user,
    dob: u.user_info?.date_of_birth?.toISOString().slice(0, 10) ?? null,
    links: edges.map((e) => {
      const other = e.user_id === id ? e.family_id : e.user_id;
      return `${e.relation} ${e.user_id === id ? "->" : "<-"} ${nameOf.get(other)} (#${other})`;
    }),
  };
}

async function mergeLoserIntoKeeper(loserId: number, keeperId: number) {
  const edges = await prisma.family_relation.findMany({
    where: { OR: [{ user_id: loserId }, { family_id: loserId }] },
    select: { user_id: true, family_id: true, relation: true },
  });
  const ops: any[] = [];
  for (const e of edges) {
    const nu = e.user_id === loserId ? keeperId : e.user_id;
    const nf = e.family_id === loserId ? keeperId : e.family_id;
    if (nu === nf) continue; // loser linked directly to keeper — just drop it
    ops.push(
      prisma.family_relation.upsert({
        where: { user_id_family_id: { user_id: nu, family_id: nf } },
        update: { relation: e.relation },
        create: { user_id: nu, family_id: nf, relation: e.relation },
      }),
    );
  }
  ops.push(prisma.family_relation.deleteMany({ where: { OR: [{ user_id: loserId }, { family_id: loserId }] } }));
  ops.push(prisma.user_info.deleteMany({ where: { user_id: loserId } }));
  ops.push(prisma.user.delete({ where: { id: loserId } }));
  await prisma.$transaction(ops);
}

async function main() {
  if (!Number.isInteger(keepId) || !Number.isInteger(removeId) || keepId === removeId) {
    console.error("Usage: mergeChildPair.ts <keepId> <removeId> [--apply]  (distinct ids)");
    process.exitCode = 1;
    return;
  }
  const keep = await describe(keepId);
  const remove = await describe(removeId);
  if (!keep) { console.error(`Keep id #${keepId} not found.`); process.exitCode = 1; return; }
  if (!remove) { console.error(`Remove id #${removeId} not found.`); process.exitCode = 1; return; }

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — merge #${removeId} into #${keepId}\n`);
  console.log(`KEEP   #${keep.id} "${keep.name}" dob=${keep.dob}${keep.is_user ? " *LOGIN*" : ""}`);
  keep.links.forEach((l) => console.log(`         ${l}`));
  console.log(`REMOVE #${remove.id} "${remove.name}" dob=${remove.dob}${remove.is_user ? " *LOGIN*" : ""}`);
  remove.links.forEach((l) => console.log(`         ${l}`));

  if (remove.is_user) {
    console.error(`\nREFUSED: #${removeId} is a login account. Merge the other direction or handle manually.`);
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log(`\nDry run — no writes. After merge, #${keepId} keeps its own name/DOB and gains #${removeId}'s parent links.`);
    console.log(`Re-run with --apply to execute (snapshot the DB first).`);
    return;
  }

  await mergeLoserIntoKeeper(removeId, keepId);
  console.log(`\nMerged. #${removeId} deleted; its links now point to #${keepId}.`);
  console.log(`Run \`npm run reconcile:family-relations\` to re-assert grandparent links.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
