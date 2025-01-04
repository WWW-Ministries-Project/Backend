import { Router } from "express";
import {
  createAsset,
  deleteAsset,
  listAssets,
  getAsset,
  updateAsset,
} from "../assets/assetController";
import multer from "multer";
import { Permissions } from "../../middleWare/authorization";
const upload = multer({ dest: "uploads/" });
const permissions = new Permissions();
const protect = permissions.protect;
export const assetRouter = Router();

// Asset
assetRouter.post(
  "/create-asset",
  [protect, upload.single("file"), permissions.can_view_asset],
  createAsset
);
assetRouter.get(
  "/list-assets",
  [protect, permissions.can_view_asset],
  listAssets
);
assetRouter.get("/get-asset", [protect, permissions.can_view_asset], getAsset);
assetRouter.put(
  "/update-asset",
  [protect, permissions.can_view_asset, upload.single("file")],
  updateAsset
);
assetRouter.delete(
  "/delete-asset",
  [protect, permissions.can_view_asset, upload.single("file")],
  deleteAsset
);
