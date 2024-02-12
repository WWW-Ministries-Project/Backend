import { Router } from 'express';
import { can_manage_access, protect } from '../middleWare/authorization';
import { createAsset, deleteAsset, listAssets } from '../controllers/assetController';

export const assetRouter = Router();

assetRouter.post("/create-asset", [protect], createAsset);
assetRouter.get("/list-assets", [protect], listAssets);
assetRouter.put("/update-asset", [protect], createAsset);
assetRouter.delete("/delete_asset", [protect], deleteAsset);