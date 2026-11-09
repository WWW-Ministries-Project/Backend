import { Request, Response } from "express";
import {
  findDuplicateChildCandidates,
  mergeChildRecords,
} from "./dataQualityService";
import {
  startBulkMergeJob,
  getBulkMergeJob,
  type BulkMergePair,
} from "./dataQualityJobs";
import { getRequestAccess } from "../../middleWare/authorization";

// GET /user/data-quality/duplicate-children
// Lists candidate duplicate child records (exact + fuzzy) with evidence. The
// client decides which to merge. Read-only. Guarded by Data_Quality view.
export const listDuplicateChildren = async (_req: Request, res: Response) => {
  try {
    const candidates = await findDuplicateChildCandidates();
    return res.status(200).json({
      message: "Operation Successful",
      data: {
        total: candidates.length,
        exact: candidates.filter((c) => c.match_type === "exact").length,
        fuzzy: candidates.filter((c) => c.match_type === "fuzzy").length,
        candidates,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", data: error });
  }
};

// POST /user/data-quality/merge-children  { keep_id, remove_id }
// Merges a confirmed duplicate pair: re-points the removed record's family links
// onto the kept one, then deletes it. Guarded by Data_Quality manage.
export const mergeDuplicateChildren = async (req: Request, res: Response) => {
  const keepId = Number(req.body?.keep_id);
  const removeId = Number(req.body?.remove_id);

  if (!Number.isInteger(keepId) || !Number.isInteger(removeId)) {
    return res.status(400).json({
      message: "keep_id and remove_id are required and must be ids.",
      data: null,
    });
  }
  if (keepId === removeId) {
    return res.status(400).json({
      message: "keep_id and remove_id must be different.",
      data: null,
    });
  }

  try {
    const result = await mergeChildRecords(keepId, removeId);
    return res.status(200).json({
      message: "Records merged",
      data: result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not merge records.";
    // Caller-fixable problems (not found, login account, equal ids) are 400s.
    const isClientError =
      /not found|login account|must be|different/i.test(msg);
    return res.status(isClientError ? 400 : 500).json({
      message: msg,
      data: null,
    });
  }
};

// POST /user/data-quality/merge-children/bulk  { pairs: [{ keep_id, remove_id }] }
// Starts a background job that merges every selected pair sequentially, so the
// user can keep working while it runs. Returns a job id to poll. Each pair is
// its own transaction — one failure does not undo earlier successes. Guarded by
// Data_Quality manage.
export const bulkMergeDuplicateChildren = (req: Request, res: Response) => {
  const rawPairs = Array.isArray(req.body?.pairs) ? req.body.pairs : null;
  if (!rawPairs || rawPairs.length === 0) {
    return res.status(400).json({
      message: "pairs is required and must be a non-empty array.",
      data: null,
    });
  }

  const seen = new Set<string>();
  const pairs: BulkMergePair[] = [];
  for (const p of rawPairs) {
    const keepId = Number(p?.keep_id);
    const removeId = Number(p?.remove_id);
    if (
      !Number.isInteger(keepId) ||
      !Number.isInteger(removeId) ||
      keepId === removeId
    ) {
      return res.status(400).json({
        message: "Each pair needs distinct integer keep_id and remove_id.",
        data: null,
      });
    }
    // De-dupe identical pairs so the same merge is not attempted twice.
    const key = [keepId, removeId].sort((a, b) => a - b).join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ keep_id: keepId, remove_id: removeId });
  }

  const createdBy = getRequestAccess(req)?.userId ?? null;
  const job = startBulkMergeJob(pairs, createdBy);
  return res.status(202).json({ message: "Bulk merge started", data: job });
};

// GET /user/data-quality/merge-children/jobs/:jobId
// Returns the current state of a bulk-merge job (status, counts, per-pair
// results). Guarded by Data_Quality view.
export const getBulkMergeJobStatus = (req: Request, res: Response) => {
  const job = getBulkMergeJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ message: "Job not found", data: null });
  }
  return res.status(200).json({ message: "Operation Successful", data: job });
};
