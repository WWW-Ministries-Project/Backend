import { Router } from "express";
import {
  createAsset,
  deleteAsset,
  listAssets,
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
