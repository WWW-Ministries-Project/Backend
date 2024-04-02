import { Router } from 'express';
import { can_manage_access, protect } from '../middleWare/authorization';
import { createAsset, deleteAsset, listAssets, updateAsset } from '../controllers/assetController';

export const assetRouter = Router();

assetRouter.post("/create-asset", createAsset);
assetRouter.get("/list-assets", listAssets);
assetRouter.put("/update-asset", updateAsset);
assetRouter.delete("/delete-asset", deleteAsset);
