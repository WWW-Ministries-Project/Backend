import { Request, Response } from "express";
import {
  findDuplicateChildCandidates,
  mergeChildRecords,
} from "./dataQualityService";

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
