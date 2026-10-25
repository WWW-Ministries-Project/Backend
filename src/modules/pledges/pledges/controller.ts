import { Request, Response } from "express";
import { PledgeService } from "./service";
import {
  validatePledgeMutationPayload,
  validateSettlementAccount,
  sendPledgeError,
  PledgeHttpError,
} from "../common";
import { assertPledgeReachable, pledgeViewer } from "../pledgeAccess";
import { getRequestAccess } from "../../../middleWare/authorization";
import { actionAllowed } from "../../../permissions/access";

const service = new PledgeService();

export const createPledge = async (req: Request, res: Response) => {
  try {
    const payload = validatePledgeMutationPayload(req.body);
    /**
     * Optional, deliberately.
     *
     * Every pledge created through the dashboard supplies these - the form
     * requires them - and gets a Paystack subaccount so members can redeem it
     * online. But rejecting a create that omits them would break any client
     * still running a build from before this field existed, for a pledge that
     * is otherwise perfectly valid. A pledge without an account is simply not
     * payable online (`can_be_paid_online: false`), exactly like every pledge
     * that predates this feature, and saving one later mints the subaccount.
     *
     * Partial details are still rejected: `validateSettlementAccount` only
     * returns undefined when the account is absent entirely.
     */
    const account = validateSettlementAccount(req.body);
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
      pledgeViewer(req),
    );
    return res.status(200).json({ message: "Pledges fetched", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const getPledge = async (req: Request, res: Response) => {
  try {
    const id = Number(req.query?.id);
    const data = await service.detail(id, pledgeViewer(req));
    return res.status(200).json({ message: "Pledge fetched", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const updatePledge = async (req: Request, res: Response) => {
  try {
    const payload = validatePledgeMutationPayload(req.body, { requireGroups: false });
    // A meta-only edit omits these entirely and leaves the account untouched.
    const account = validateSettlementAccount(req.body);
    const id = Number(req.body?.id ?? req.query?.id);
    await assertPledgeReachable(id, pledgeViewer(req));
    const data = await service.update(id, payload, account, {
      manageCallers: actionAllowed(getRequestAccess(req)?.permissions ?? {}, "Pledges", "manage_callers"),
    });
    return res.status(200).json({ message: "Pledge updated", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const deletePledge = async (req: Request, res: Response) => {
  try {
    await assertPledgeReachable(Number(req.query?.id), pledgeViewer(req));
    await service.remove(Number(req.query?.id));
    return res.status(200).json({ message: "Pledge deleted" });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};

export const remindPledgers = async (req: Request, res: Response) => {
  try {
    const pledgeId = Number(req.body?.pledge_id);
    if (!pledgeId) throw new PledgeHttpError(400, "pledge_id is required");
    await assertPledgeReachable(pledgeId, pledgeViewer(req));
    const ids = Array.isArray(req.body?.pledger_ids)
      ? req.body.pledger_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : undefined;
    if (ids && ids.length === 0) throw new PledgeHttpError(400, "pledger_ids must list at least one pledger");
    const data = await service.remind(pledgeId, ids, (req as any).user?.id);
    return res.status(200).json({ message: "Reminders sent", data });
  } catch (e) {
    return sendPledgeError(res, e);
  }
};
