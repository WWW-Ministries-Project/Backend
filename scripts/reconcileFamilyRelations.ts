// OPTIONAL post-deploy pass for family relationships.
//
// The CHILD/PARENT backfill from the legacy `user.parent_id` column runs
// automatically as a SQL migration
// (20261105000000_backfill_family_relations_from_parent_id), so you do NOT need
// this script to make parents, children, or siblings correct.
//
// What this adds: grandparent/grandchild links. Those are derived, not stored by
// the SQL backfill — the app maintains them on every write via
// upsertBidirectionalFamilyRelation. Running this re-asserts every existing CHILD
// link through that helper, which reconciles grandparent/grandchild rows for data
// that only ever existed as the legacy scalar parent_id.
//
// Idempotent and safe to run any time AFTER migrations:
//   npx ts-node --transpile-only scripts/reconcileFamilyRelations.ts
//   # or: npm run reconcile:family-relations
import "dotenv/config";
import { prisma } from "../src/Models/context";
import {
  FAMILY_RELATION,
  upsertBidirectionalFamilyRelation,
} from "../src/modules/user/familyRelations";

async function main() {
  // Every parent -> child edge currently in the graph.
  const childLinks = await prisma.family_relation.findMany({
    where: { relation: FAMILY_RELATION.CHILD },
    select: { user_id: true, family_id: true },
  });

  console.log(`Reconciling ${childLinks.length} CHILD links (grandparent sync).`);

  let ok = 0;
  let failed = 0;
  for (const { user_id, family_id } of childLinks) {
    try {
      // Idempotent: upserts the CHILD row + PARENT reciprocal and reconciles
      // grandparent/grandchild links for both ends.
      await upsertBidirectionalFamilyRelation(
        user_id,
        family_id,
        FAMILY_RELATION.CHILD,
      );
      ok++;
    } catch (error) {
      failed++;
      console.error(
        `Failed to reconcile ${user_id} -> ${family_id}:`,
        (error as Error).message,
      );
    }
  }

  // Verification snapshot.
  const counts = await prisma.family_relation.groupBy({
    by: ["relation"],
    _count: { _all: true },
  });
  console.log("family_relation counts by type:");
  counts.forEach((c) => console.log(`  ${c.relation}: ${c._count._all}`));

  console.log(`Reconcile done. ok=${ok}, failed=${failed}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
