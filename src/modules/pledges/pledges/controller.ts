import { Request, Response } from "express";
import { PledgeService } from "./service";
import { validatePledgeMutationPayload, sendPledgeError } from "../common";

const service = new PledgeService();

export const createPledge = async (req: Request, res: Response) => {
  try {
    const payload = validatePledgeMutationPayload(req.body);
    const data = await service.create(payload, (req as any).user?.id);
    return res.status(201).json({ message: "Pledge created", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const getPledges = async (req: Request, res: Response) => {
  try {
    const data = await service.list(
      req.query?.branch_id as string,
      req.query?.status as string,
    );
    return res.status(200).json({ message: "Pledges fetched", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const getPledge = async (req: Request, res: Response) => {
  try {
    const id = Number(req.query?.id);
    const data = await service.detail(id);
    return res.status(200).json({ message: "Pledge fetched", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const updatePledge = async (req: Request, res: Response) => {
  try {
    const payload = validatePledgeMutationPayload(req.body, { requireGroups: false });
    const id = Number(req.body?.id ?? req.query?.id);
    const data = await service.update(id, payload);
    return res.status(200).json({ message: "Pledge updated", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const deletePledge = async (req: Request, res: Response) => {
  try {
    await service.remove(Number(req.query?.id));
    return res.status(200).json({ message: "Pledge deleted" });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};
