import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { sermonController } from "./sermonController";
import {
  attachSermonDraftAccess,
  requireSermonRecordInBranch,
} from "./sermonAccess";

const controller = new sermonController();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

const router = Router();

// Who may see drafts: Sermons.view_drafts (see sermonAccess.ts).
const drafts = [permissions.attach_sermon_management, attachSermonDraftAccess];
const seriesInBranch = requireSermonRecordInBranch("series");
const sermonInBranch = requireSermonRecordInBranch("sermon");

// Static paths first: /:id would otherwise swallow "series" and "tags".
router.get("/tags", [protect], controller.listTags);

// Spoken-word search over stored sermon transcripts. Any authenticated member.
router.post("/transcript-search", [protect], controller.searchTranscripts);

// Transcribe a YouTube sermon with Whisper (spends OpenAI credit) — gated to
// sermon managers. Populates the store that transcript-search reads.
router.post(
  "/transcribe",
  [protect, permissions.requireAction("Sermons", "create", "Not authorized to transcribe sermons")],
  controller.transcribeSermon,
);

// Transcribe the channel's recent videos in bulk (free captions by default).
router.post(
  "/transcribe-recent",
  [protect, permissions.requireAction("Sermons", "create", "Not authorized to transcribe sermons")],
  controller.transcribeRecent,
);

router.get("/series", [protect, ...drafts], controller.listSeries);
router.get(
  "/series/:id",
  [protect, ...drafts, seriesInBranch],
  controller.getOneSeries,
);
router.post(
  "/series",
  [protect, permissions.requireAction("Sermons", "manage_series", "Not authorized to manage sermon series")],
  controller.createSeries,
);
router.put(
  "/series/:id",
  [
    protect,
    permissions.requireAction("Sermons", "manage_series", "Not authorized to manage sermon series"),
    seriesInBranch,
  ],
  controller.updateSeries,
);
router.delete(
  "/series/:id",
  [
    protect,
    permissions.requireAction("Sermons", "delete", "Not authorized to delete sermon series"),
    seriesInBranch,
  ],
  controller.removeSeries,
);

// Sermons. Open to any authenticated member for reads; writes stay gated.
router.get("/", [protect, ...drafts], controller.list);
router.get("/:id", [protect, ...drafts, sermonInBranch], controller.getOne);

router.post(
  "/",
  [protect, permissions.requireAction("Sermons", "create", "Not authorized to add sermons")],
  controller.create,
);
router.put(
  "/:id",
  [
    protect,
    permissions.requireAction("Sermons", "create", "Not authorized to edit sermons"),
    sermonInBranch,
  ],
  controller.update,
);
router.post(
  "/:id/publish",
  [
    protect,
    permissions.requireAction("Sermons", "publish", "Not authorized to publish sermons"),
    sermonInBranch,
  ],
  controller.publish,
);
router.post(
  "/:id/unpublish",
  [
    protect,
    permissions.requireAction("Sermons", "publish", "Not authorized to unpublish sermons"),
    sermonInBranch,
  ],
  controller.unpublish,
);
router.delete(
  "/:id",
  [
    protect,
    permissions.requireAction("Sermons", "delete", "Not authorized to delete sermons"),
    sermonInBranch,
  ],
  controller.remove,
);

export default router;
