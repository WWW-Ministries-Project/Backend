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
const upload = multer({ dest: "uploads/" });

export const assetRouter = Router();

// Asset
assetRouter.post("/create-asset", upload.single("file"), createAsset);
assetRouter.get("/list-assets", listAssets);
assetRouter.put("/update-asset", updateAsset);
assetRouter.delete("/delete-asset", deleteAsset);

// Category
assetRouter.post("/create-category", createAssetCategory);
assetRouter.get("/list-category", listAssetCategory);
assetRouter.put("/update-category", updateAssetCategory);
assetRouter.delete("/delete-category", deleteAssetCategory);
