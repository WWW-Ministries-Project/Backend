// One-off cleanup for duplicate child records in the member directory.
//
// WHY: children are meant to exist once, but the per-family match in saveFamily
// only looked inside the current family. When two parents entered the same child
// in separate registrations, a second `user` row was created. These show up as
// duplicate rows in the Children directory (same name + date of birth, different
// ids). The code fix (familyRelations.findExistingChildUserId) stops NEW
// duplicates; this script merges the EXISTING ones.
//
// WHAT it does, per group of child users sharing a normalized first+last name
// and date of birth:
//   - keeper = the lowest id (both are placeholders, so this is just stable)
//   - every family_relation edge touching a loser is re-pointed onto the keeper
//     (direction and relation preserved, de-duplicated against the unique key)
//   - the loser's user_info and user rows are deleted
// All writes for a group run in ONE transaction, so a foreign-key failure (a
// loser referenced by some other table) rolls that group back and it is skipped
// for manual review rather than half-merged.
//
// SAFETY:
//   - DRY RUN by default: prints the plan, writes nothing.
//   - Pass --apply to execute. TAKE A DATABASE SNAPSHOT FIRST.
//   - A group is skipped (never merged) if any member is a login account
//     (is_user = true) or is itself a parent (has its own children).
//
// Run:
//   npx ts-node --transpile-only scripts/dedupeChildren.ts            # dry run
//   npx ts-node --transpile-only scripts/dedupeChildren.ts --apply    # execute
//   # or: npm run dedupe:children [-- --apply]
//
// After --apply, run `npm run reconcile:family-relations` to re-assert
// grandparent/grandchild links for the merged families.
import "dotenv/config";
import { prisma } from "../src/Models/context";
import { FAMILY_RELATION } from "../src/modules/user/familyRelations";

const APPLY = process.argv.includes("--apply");

const norm = (s?: string | null) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const dobKey = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

type ChildUser = {
  id: number;
  is_user: boolean | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: Date | null;
};

async function getChildUserIds(): Promise<number[]> {
  // "Is a child" = has an incoming CHILD edge (family_id) or a forward PARENT
  // edge (user_id) — the two directions getDirectChildIds walks.
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
  return Array.from(ids);
}

async function hasOwnChildren(userId: number): Promise<boolean> {
  const [fwd, rev] = await Promise.all([
    prisma.family_relation.count({
      where: { user_id: userId, relation: FAMILY_RELATION.CHILD },
    }),
    prisma.family_relation.count({
      where: { family_id: userId, relation: FAMILY_RELATION.PARENT },
    }),
  ]);
  return fwd + rev > 0;
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
    if (nu === nf) continue; // loser was linked directly to keeper — drop it
    ops.push(
      prisma.family_relation.upsert({
        where: { user_id_family_id: { user_id: nu, family_id: nf } },
        update: { relation: e.relation },
        create: { user_id: nu, family_id: nf, relation: e.relation },
      }),
    );
  }
  // Remove the loser's edges, its user_info, then the user row. The transaction
  // fails (and rolls back) if anything else still references the loser.
  ops.push(
    prisma.family_relation.deleteMany({
      where: { OR: [{ user_id: loserId }, { family_id: loserId }] },
    }),
  );
  ops.push(prisma.user_info.deleteMany({ where: { user_id: loserId } }));
  ops.push(prisma.user.delete({ where: { id: loserId } }));

  await prisma.$transaction(ops);
}

async function main() {
  console.log(`\nDedupe children — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

  const childIds = await getChildUserIds();
  if (!childIds.length) {
    console.log("No child users found.");
    return;
  }

  const users = (await prisma.user.findMany({
    where: { id: { in: childIds } },
    select: {
      id: true,
      is_user: true,
      user_info: {
        select: { first_name: true, last_name: true, date_of_birth: true },
      },
    },
    orderBy: { id: "asc" },
  })).map<ChildUser>((u) => ({
    id: u.id,
    is_user: u.is_user,
    first_name: u.user_info?.first_name ?? null,
    last_name: u.user_info?.last_name ?? null,
    date_of_birth: u.user_info?.date_of_birth ?? null,
  }));

  const groups = new Map<string, ChildUser[]>();
  for (const u of users) {
    const first = norm(u.first_name);
    const last = norm(u.last_name);
    const dob = dobKey(u.date_of_birth);
    if (!first || !last || !dob) continue; // can't safely match without all three
    const key = `${first} ${last}|${dob}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(u);
    else groups.set(key, [u]);
  }

  const dupGroups = Array.from(groups.entries()).filter(([, v]) => v.length > 1);
  console.log(`Child users: ${users.length}. Duplicate groups: ${dupGroups.length}.\n`);

  let merged = 0;
  let skipped = 0;
  let failed = 0;

  for (const [key, members] of dupGroups) {
    members.sort((a, b) => a.id - b.id);
    const keeper = members[0];
    const losers = members.slice(1);
    const name = key.split("|")[0];

    // Guard: never merge a login account or a record that is itself a parent.
    const flagged: number[] = [];
    for (const m of [keeper, ...losers]) {
      if (m.is_user) flagged.push(m.id);
      else if (await hasOwnChildren(m.id)) flagged.push(m.id);
    }
    if (flagged.length) {
      console.log(`SKIP  ${name} — needs manual review (account/parent): ids ${flagged.join(", ")}`);
      skipped++;
      continue;
    }

    console.log(`${APPLY ? "MERGE" : "PLAN "} ${name}: keep ${keeper.id}, remove ${losers.map((l) => l.id).join(", ")}`);

    if (APPLY) {
      for (const loser of losers) {
        try {
          await mergeLoserIntoKeeper(loser.id, keeper.id);
          merged++;
        } catch (err) {
          failed++;
          console.log(`  FAIL id ${loser.id}: ${(err as Error).message}`);
        }
      }
    }
  }

  console.log(
    `\nDone. Groups: ${dupGroups.length}, skipped: ${skipped}` +
      (APPLY ? `, losers merged: ${merged}, failed: ${failed}` : " (dry run — no writes)") +
      ".",
  );
  if (!APPLY && dupGroups.length > skipped) {
    console.log("Re-run with --apply to execute (snapshot the DB first).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
