import test from "node:test";
import assert from "node:assert/strict";
import {
  BranchScope,
  branchScopeContext,
  readRequestedBranchIds,
  setBranchScope,
} from "./branchScope";
import { assertBranchAccessible, getBranchScopedWhere } from "./branchService";

const withScope = <T>(scope: BranchScope | null, fn: () => T): T => {
  let result: T;
  branchScopeContext({} as any, {} as any, () => {
    setBranchScope(scope);
    result = fn();
  });
  return result!;
};

test("no scope leaves lists unfiltered unless a branch is asked for", () => {
  assert.equal(getBranchScopedWhere(undefined), undefined);
  assert.deepEqual(getBranchScopedWhere("3"), { branch_id: 3 });
});

test("an admin limited to branches sees only those branches", () => {
  const scope = { allowedBranchIds: [1, 2], activeBranchId: null };
  assert.deepEqual(
    withScope(scope, () => getBranchScopedWhere(undefined)),
    { branch_id: { in: [1, 2] } },
  );
});

test("the active branch applies when the query has no branch_id", () => {
  const scope = { allowedBranchIds: [1, 2], activeBranchId: 2 };
  assert.deepEqual(
    withScope(scope, () => getBranchScopedWhere(undefined, "branchId")),
    { branchId: 2 },
  );
});

test("a branch outside the caller's branches matches nothing", () => {
  const scope = { allowedBranchIds: [1], activeBranchId: 1 };
  assert.deepEqual(
    withScope(scope, () => getBranchScopedWhere(5)),
    { branch_id: { in: [] } },
  );
  assert.throws(() => withScope(scope, () => assertBranchAccessible(5)));
  assert.doesNotThrow(() => withScope(scope, () => assertBranchAccessible(1)));
});

test("requested branch ids come from header, query and body", () => {
  assert.deepEqual(
    readRequestedBranchIds({
      headers: { "x-branch-id": "2" },
      query: { branch_id: "2" },
      body: { branch_id: 4 },
    }),
    [2, 4],
  );
  assert.deepEqual(readRequestedBranchIds({ headers: {}, query: {}, body: {} }), []);
});
