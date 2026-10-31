import { Router } from "express";
import multer from "multer";
import {
  createAsset,
  deleteAsset,
  listAssets,
  getAsset,
  updateAsset,
} from "../assets/assetController";
import { Permissions } from "../../middleWare/authorization";
import { requestLogger } from "../../utils/loggers";
import { wrapControllersWithLogger } from "../../utils/catchAsyncFunction";
import { assetRedesignControllers } from "./assetRedesignController";
const upload = multer({ dest: "uploads/" });
const permissions = new Permissions();
const protect = permissions.protect;

export const assetRouter = Router();

/**
 * Resolves the viewer's asset access (role, scope, department membership),
 * then requires `Asset.<action>`. Services narrow further (scope, sub-actions).
 */
const act = (action: string) => [
  permissions.can_view_assets_scoped,
  permissions.requireAction("Asset", action, "You can't change assets."),
];

/**
 * @swagger
 * tags:
 *   name: Assets
 *   description: Asset management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Asset:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         asset_id:
 *           type: string
 *           example: WWM-HC-ASSET-20250001
 *         name:
 *           type: string
 *           example: Projector
 *         department_assigned:
 *           type: integer
 *           example: 2
 *         date_purchased:
 *           type: string
 *           format: date
 *           example: 2025-07-20
 *         date_assigned:
 *           type: string
 *           format: date
 *           example: 2025-07-25
 *         price:
 *           type: number
 *           example: 1500.50
 *         status:
 *           type: string
 *           example: Active
 *         supplier:
 *           type: string
 *           example: ABC Electronics
 *         description:
 *           type: string
 *           example: Full HD Projector for church events
 *         photo:
 *           type: string
 *           example: uploads/projector.jpg
 *     CreateAssetRequest:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: Projector
 *         department_assigned:
 *           type: integer
 *           example: 2
 *         date_purchased:
 *           type: string
 *           format: date
 *           example: 2025-07-20
 *         date_assigned:
 *           type: string
 *           format: date
 *           example: 2025-07-25
 *         price:
 *           type: number
 *           example: 1500.50
 *         status:
 *           type: string
 *           example: Active
 *         supplier:
 *           type: string
 *           example: ABC Electronics
 *         description:
 *           type: string
 *           example: Full HD Projector for church events
 *         photo:
 *           type: string
 *           example: uploads/projector.jpg
 *     UpdateAssetRequest:
 *       type: object
 *       required:
 *         - id
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: Projector (Updated)
 *         department_assigned:
 *           type: integer
 *           example: 2
 *         price:
 *           type: number
 *           example: 1400.00
 *         description:
 *           type: string
 *           example: Updated projector description
 */

/**
 * @swagger
 * /assets/create-asset:
 *   post:
 *     summary: Create a new asset
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/CreateAssetRequest'
 *     responses:
 *       200:
 *         description: Asset created successfully
 */
assetRouter.post(
  "/create-asset",
  [protect, upload.single("file"), ...act("create")],
  createAsset,
);

/**
 * @swagger
 * /assets/list-assets:
 *   get:
 *     summary: List all assets (paginated)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: take
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of assets
 */
assetRouter.get(
  "/list-assets",
  [protect, permissions.can_view_assets_scoped],
  listAssets,
);

/**
 * @swagger
 * /assets/get-asset:
 *   get:
 *     summary: Get details of a specific asset
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Asset details
 */
assetRouter.get(
  "/get-asset",
  [protect, permissions.can_view_assets_scoped],
  getAsset,
);

/**
 * @swagger
 * /assets/update-asset:
 *   put:
 *     summary: Update an existing asset
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAssetRequest'
 *     responses:
 *       200:
 *         description: Asset updated successfully
 */
assetRouter.put(
  "/update-asset",
  [protect, ...act("edit"), upload.single("file")],
  updateAsset,
);

/**
 * @swagger
 * /assets/delete-asset:
 *   delete:
 *     summary: Delete an asset
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Asset deleted successfully
 */
assetRouter.delete(
  "/delete-asset",
  [protect, ...act("delete"), upload.single("file")],
  deleteAsset,
);

/* -------------------------------------------------------------------------- */
/*                 Assets redesign (docs/ASSETS_REDESIGN_FRONTEND_GUIDE.md)    */
/* -------------------------------------------------------------------------- */

const redesign = wrapControllersWithLogger(assetRedesignControllers, requestLogger);
// Every route resolves the viewer's asset access first; services enforce
// the Asset actions, scope and per-department counting rules on top
// (save-asset, update-status and restore pick create/edit or assign/change_status by payload).
const view = [protect, permissions.can_view_assets_scoped];
const manage = (action: string) => [protect, ...act(action)];

assetRouter.get("/overview", view, redesign.assetOverviewHandler);
assetRouter.get("/history", view, redesign.assetHistoryHandler);
assetRouter.post("/save-asset", view, redesign.saveAssetHandler);
assetRouter.post("/update-status", view, redesign.updateAssetStatusHandler);
assetRouter.post("/restore", view, redesign.restoreAssetsHandler);
assetRouter.post("/confirm-lost", manage("write_off"), redesign.confirmAssetLostHandler);
assetRouter.post("/repair-requisition", manage("raise_requisition"), redesign.raiseRepairRequisitionHandler);
assetRouter.post("/clear-repair-requisition", manage("clear_repair"), redesign.clearRepairRequisitionHandler);

assetRouter.get("/stock-checks", view, redesign.listStockChecksHandler);
assetRouter.get("/stock-checks/detail", view, redesign.stockCheckDetailHandler);
assetRouter.post("/stock-checks/start", manage("stock_check"), redesign.startStockCheckHandler);
assetRouter.post("/stock-checks/cancel", manage("stock_check"), redesign.cancelStockCheckHandler);
assetRouter.post("/stock-checks/mark", view, redesign.markStockCheckItemsHandler);
assetRouter.post("/stock-checks/set-fix", manage("reconcile"), redesign.setStockCheckFixHandler);
assetRouter.post("/stock-checks/add-extra", view, redesign.addStockCheckExtraHandler);
assetRouter.post("/stock-checks/remove-extra", view, redesign.removeStockCheckExtraHandler);
assetRouter.post("/stock-checks/submit", view, redesign.submitStockCheckDepartmentHandler);
assetRouter.post("/stock-checks/reopen", view, redesign.reopenStockCheckDepartmentHandler);
assetRouter.post("/stock-checks/remind", manage("stock_check"), redesign.remindStockCheckCountersHandler);
assetRouter.post("/stock-checks/recount", manage("request_recount"), redesign.requestStockCheckRecountHandler);
assetRouter.post("/stock-checks/mark-rest-missing", manage("reconcile"), redesign.markRestMissingHandler);
assetRouter.post("/stock-checks/close", manage("stock_check"), redesign.closeStockCheckHandler);
