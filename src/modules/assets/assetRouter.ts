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
const upload = multer({ dest: "uploads/" });
const permissions = new Permissions();
const protect = permissions.protect;

export const assetRouter = Router();

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
  [protect, upload.single("file"), permissions.can_manage_asset],
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
  [protect, permissions.can_manage_asset, upload.single("file")],
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
  [protect, permissions.can_delete_asset, upload.single("file")],
  deleteAsset,
);
