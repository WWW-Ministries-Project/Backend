import { Request, Response } from "express";
import { RedemptionService } from "./service";
import { validateRedemptionPayload, sendPledgeError, PledgeHttpError } from "../common";

const service = new RedemptionService();

export const createRedemption = async (req: Request, res: Response) => {
  try {
    validateRedemptionPayload(req.body);
    const data = await service.create(req.body, (req as any).file, (req as any).user?.id);
    return res.status(201).json({ message: "Redemption recorded", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const deleteRedemption = async (req: Request, res: Response) => {
  try {
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
    const data = await service.addPledgers(groupId, req.body?.pledgers ?? []);
    return res.status(201).json({ message: "Pledgers added", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const deletePledger = async (req: Request, res: Response) => {
  try {
    await service.removePledger(Number(req.query?.id));
    return res.status(200).json({ message: "Pledger removed" });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};
