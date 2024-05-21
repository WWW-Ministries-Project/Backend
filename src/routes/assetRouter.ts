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
export const assetRouter = Router();

// Asset
assetRouter.post("/create-asset", createAsset);
assetRouter.get("/list-assets", listAssets);
assetRouter.put("/update-asset", updateAsset);
assetRouter.delete("/delete-asset", deleteAsset);

// Category
assetRouter.post("/create-category", createAssetCategory);
assetRouter.get("/list-category", listAssetCategory);
assetRouter.put("/update-category", updateAssetCategory);
assetRouter.delete("/delete-category", deleteAssetCategory);
