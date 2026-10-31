import { Request, Response } from "express";
import {
  clearRepairRequisition,
  confirmAssetLost,
  getAssetHistory,
  getAssetOverview,
  raiseRepairRequisitions,
  restoreAssets,
  saveAsset,
  updateAssetStatus,
} from "./asset-redesign";
import {
  addStockCheckExtra,
  cancelStockCheck,
  closeStockCheck,
  getStockCheckDetail,
  listStockChecks,
  markRestMissing,
  markStockCheckItems,
  remindStockCheckCounters,
  removeStockCheckExtra,
  reopenStockCheckDepartment,
  requestStockCheckRecount,
  setStockCheckFix,
  startStockCheck,
  submitStockCheckDepartment,
} from "./asset-stock-check";

type Service = (req: any) => Promise<unknown>;

const handler =
  (service: Service, message = "Operation successful", status = 200) =>
  async (req: Request, res: Response) => {
    const data = await service(req);
    res.status(status).json({ message, data });
  };

export const assetRedesignControllers = {
  assetOverviewHandler: handler(getAssetOverview),
  assetHistoryHandler: handler(getAssetHistory),
  saveAssetHandler: handler(saveAsset, "Asset saved"),
  updateAssetStatusHandler: handler(updateAssetStatus, "Status updated"),
  restoreAssetsHandler: handler(restoreAssets, "Change undone"),
  confirmAssetLostHandler: handler(confirmAssetLost, "Confirmed as lost"),
  raiseRepairRequisitionHandler: handler(raiseRepairRequisitions, "Requisition submitted", 201),
  clearRepairRequisitionHandler: handler(clearRepairRequisition, "Requisition cleared"),
  listStockChecksHandler: handler(listStockChecks),
  stockCheckDetailHandler: handler(getStockCheckDetail),
  startStockCheckHandler: handler(startStockCheck, "Stock check started", 201),
  cancelStockCheckHandler: handler(cancelStockCheck, "Stock check cancelled"),
  markStockCheckItemsHandler: handler(markStockCheckItems, "Count saved"),
  setStockCheckFixHandler: handler(setStockCheckFix, "Decision saved"),
  addStockCheckExtraHandler: handler(addStockCheckExtra, "Item recorded", 201),
  removeStockCheckExtraHandler: handler(removeStockCheckExtra, "Item removed"),
  submitStockCheckDepartmentHandler: handler(submitStockCheckDepartment, "Count submitted"),
  reopenStockCheckDepartmentHandler: handler(reopenStockCheckDepartment, "Count reopened"),
  remindStockCheckCountersHandler: handler(remindStockCheckCounters, "Reminders sent"),
  requestStockCheckRecountHandler: handler(requestStockCheckRecount, "Recount requested"),
  markRestMissingHandler: handler(markRestMissing, "Recorded as not found"),
  closeStockCheckHandler: handler(closeStockCheck, "Stock check closed"),
};
