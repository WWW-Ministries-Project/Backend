import { Request, Response } from "express";
import { PledgeHttpError, sendPledgeError } from "../common";
import { PledgePaymentService } from "./service";
import {
  parsePreviewAmount,
  validateInitializePledgePayment,
} from "./validation";

const service = new PledgePaymentService();

const getActorUserId = (req: Request): number | undefined => {
  const rawId = (req as unknown as { user?: { id?: unknown } })?.user?.id;
  const parsed = Number(rawId);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parsePagination = (req: Request): { page: number; take: number } => {
  const page = Number(req.query.page ?? "1");
  const take = Number(req.query.take ?? "20");

  if (!Number.isInteger(page) || page < 1) {
    throw new PledgeHttpError(400, "Invalid page. It must be an integer >= 1");
  }

  if (!Number.isInteger(take) || take < 1) {
    throw new PledgeHttpError(400, "Invalid take. It must be an integer >= 1");
  }

  return { page, take };
};

const buildEnvelope = (
  data: unknown,
  total: number,
  page: number,
  take: number,
) => ({
  message: "Success",
  data,
  current_page: page,
  take,
  total,
  page_size: take,
  totalPages: Math.ceil(total / take),
});

export const listMyPledges = async (req: Request, res: Response) => {
  try {
    const data = await service.listMine(getActorUserId(req));
    return res.status(200).json({ message: "Success", data });
  } catch (error) {
    return sendPledgeError(res, error);
  }
};

export const previewPledgeFee = async (req: Request, res: Response) => {
  try {
    const amount = parsePreviewAmount(req.query?.amount);
    return res
      .status(200)
      .json({ message: "Success", data: service.previewFee(amount) });
  } catch (error) {
    return sendPledgeError(res, error);
  }
};

export const initializePledgePayment = async (req: Request, res: Response) => {
  try {
    const payload = validateInitializePledgePayment(req.body);
    const data = await service.initialize(getActorUserId(req), payload);
    return res.status(201).json({ message: "Payment started", data });
  } catch (error) {
    return sendPledgeError(res, error);
  }
};

export const verifyPledgePayment = async (req: Request, res: Response) => {
  try {
    const reference = req.params?.reference?.trim();

    if (!reference) throw new PledgeHttpError(400, "Invalid reference parameter");

    const data = await service.verify(getActorUserId(req), reference);
    return res.status(200).json({ message: "Success", data });
  } catch (error) {
    return sendPledgeError(res, error);
  }
};

export const listMyPledgePayments = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);
    const result = await service.listMyPayments(getActorUserId(req), pagination);

    return res
      .status(200)
      .json(buildEnvelope(result.data, result.total, pagination.page, pagination.take));
  } catch (error) {
    return sendPledgeError(res, error);
  }
};

export const listPledgePayments = async (req: Request, res: Response) => {
  try {
    const pledgeId = Number(req.query?.pledge_id);

    if (!Number.isInteger(pledgeId) || pledgeId < 1) {
      throw new PledgeHttpError(400, "pledge_id must be a positive integer");
    }

    const pagination = parsePagination(req);
    const result = await service.listForPledge(pledgeId, pagination);

    return res
      .status(200)
      .json(buildEnvelope(result.data, result.total, pagination.page, pagination.take));
  } catch (error) {
    return sendPledgeError(res, error);
  }
};

// No webhook handler here on purpose. Paystack posts every charge.success to
// the single signed endpoint at PAYSTACK_WEBHOOK_PATH, and index.ts only
// retains the raw request body for that one path - a second receiver would
// verify against an undefined body and reject every genuine event. Pledge
// payments are settled from there via paystackSettlement's reference-prefix
// dispatch.
