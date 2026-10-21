import { AsyncLocalStorage } from "async_hooks";
import { NextFunction, Request, Response } from "express";

/**
 * The branch boundary of the request being served.
 *
 * - `allowedBranchIds`: the branches the caller may touch. `null` means every
 *   branch (members, and admins with no per-branch rows).
 * - `activeBranchId`: the branch the caller is working in, from the
 *   `X-Branch-Id` header (or `branch_id` in the query/body). `null` means
 *   "all of my branches".
 *
 * Filled in by the auth middleware and read by the branch helpers in
 * `branchService`, so every list/create that already goes through
 * `getBranchScopedWhere` / `resolveBranchIdOrDefault` is clamped without
 * touching the individual modules.
 */
export type BranchScope = {
  allowedBranchIds: number[] | null;
  activeBranchId: number | null;
};

const storage = new AsyncLocalStorage<{ scope: BranchScope | null }>();

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

/** Gives each request its own (empty) scope slot. Mount before the routers. */
export const branchScopeContext = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  storage.run({ scope: null }, next);
};

export const setBranchScope = (scope: BranchScope | null) => {
  const store = storage.getStore();
  if (store) {
    store.scope = scope;
  }
};

/** The current request's branch scope, or `null` outside a request / before auth. */
export const getBranchScope = (): BranchScope | null =>
  storage.getStore()?.scope ?? null;

/** Every branch id the request names: header, query and body. */
export const readRequestedBranchIds = (req: Request | any): number[] => {
  const ids = [
    toPositiveInt(req?.headers?.["x-branch-id"]),
    toPositiveInt(req?.query?.branch_id),
    toPositiveInt(req?.body?.branch_id),
  ].filter((id): id is number => Boolean(id));
  return Array.from(new Set(ids));
};

/** The branch the caller is working in: header first, then query, then body. */
export const readActiveBranchId = (req: Request | any): number | null =>
  readRequestedBranchIds(req)[0] ?? null;

export const isBranchAllowed = (
  scope: BranchScope | null,
  branchId: number,
): boolean =>
  !scope?.allowedBranchIds || scope.allowedBranchIds.includes(branchId);

export const BRANCH_FORBIDDEN_MESSAGE =
  "You don't have access to this branch";
