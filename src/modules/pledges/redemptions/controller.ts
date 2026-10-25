import { Request, Response } from "express";
import { RedemptionService } from "./service";
import { validateRedemptionPayload, sendPledgeError, PledgeHttpError } from "../common";
import { assertPledgeReachable, pledgeIdFor, pledgeViewer } from "../pledgeAccess";

const service = new RedemptionService();

// Each write is checked against the pledge's branch first.
const reach = async (req: Request, kind: Parameters<typeof pledgeIdFor>[0], id: unknown) =>
  assertPledgeReachable(await pledgeIdFor(kind, Number(id)), pledgeViewer(req));

export const createRedemption = async (req: Request, res: Response) => {
  try {
    validateRedemptionPayload(req.body);
    await reach(req, "pledger", req.body?.pledger_id);
    const data = await service.create(req.body, (req as any).user?.id);
    return res.status(201).json({ message: "Redemption recorded", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const deleteRedemption = async (req: Request, res: Response) => {
  try {
    await reach(req, "redemption", req.query?.id);
    await service.remove(Number(req.query?.id));
    return res.status(200).json({ message: "Redemption deleted" });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const addPledgers = async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.body?.group_id);
    if (!groupId) throw new PledgeHttpError(400, "group_id is required");
    await reach(req, "group", groupId);
    const data = await service.addPledgers(groupId, req.body?.pledgers ?? []);
    return res.status(201).json({ message: "Pledgers added", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const deletePledger = async (req: Request, res: Response) => {
  try {
    await reach(req, "pledger", req.query?.id);
    await service.removePledger(Number(req.query?.id));
    return res.status(200).json({ message: "Pledger removed" });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};
