import { Request, Response } from "express";
import { PledgeService } from "./service";
import {
  validatePledgeMutationPayload,
  validateSettlementAccount,
  sendPledgeError,
} from "../common";

const service = new PledgeService();

export const createPledge = async (req: Request, res: Response) => {
  try {
    const payload = validatePledgeMutationPayload(req.body);
    // Required on create: a pledge exists to be redeemed, and it cannot take an
    // online redemption without a subaccount to route it to.
    const account = validateSettlementAccount(req.body, { required: true });
    const data = await service.create(payload, (req as any).user?.id, account);
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
    // Optional on update: a meta-only edit must not have to resend bank details.
    const account = validateSettlementAccount(req.body, { required: false });
    const id = Number(req.body?.id ?? req.query?.id);
    const data = await service.update(id, payload, account);
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
