import { Router } from "express";
import {
  createAsset,
  createAssetCategory,
  deleteAsset,
  deleteAssetCategory,
  listAssetCategory,
  listAssets,
  updateAsset,
  updateAssetCategory,
} from "../controllers/assetController";
import multer from "multer";
import { Permissions } from "../middleWare/authorization";
const upload = multer({ dest: "uploads/" });
const permissions = new Permissions();
const protect = permissions.protect;
export const assetRouter = Router();

// Asset
assetRouter.post(
  "/create-asset",
  [protect, upload.single("file"), permissions.can_create_asset],
  createAsset
);
assetRouter.get(
  "/list-assets",
  [protect, permissions.can_view_asset],
  listAssets
);
assetRouter.put(
  "/update-asset",
  [protect, permissions.can_edit_asset, upload.single("file")],
  updateAsset
);
assetRouter.delete(
  "/delete-asset",
  [protect, permissions.can_delete_access, upload.single("file")],
  deleteAsset
);

// Category
assetRouter.post("/create-category", createAssetCategory);
assetRouter.get("/list-category", listAssetCategory);
assetRouter.put("/update-category", updateAssetCategory);
assetRouter.delete("/delete-category", deleteAssetCategory);
