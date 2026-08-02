import { Request, Response } from "express";
import { PaystackConfigError } from "../../../libs/paystack/paystackCredentials";
import { handlePaystackChargeEvent } from "../../../libs/paystack/paystackSettlement";
import { verifyPaystackSignature } from "../../../libs/paystack/paystackWebhook";
import logger from "../../../utils/logger-config";
import { FinanceHttpError, parsePagination, sendFinanceError } from "../common";
import { GivingContributionService } from "./contributionService";
import {
  parseContributionFilters,
  parsePreviewAmount,
  parseReferenceQuery,
  validateInitializePayload,
  validateRetryPayload,
} from "./contributionValidation";

const service = new GivingContributionService();

const getActorUserId = (req: Request): number | undefined => {
  const rawId = (req as unknown as { user?: { id?: unknown } })?.user?.id;
  const parsed = Number(rawId);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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

export class GivingContributionController {
  async listAvailable(req: Request, res: Response): Promise<Response> {
    try {
      const data = await service.listAvailable(getActorUserId(req));

      return res.status(200).json({ message: "Success", data });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async previewFee(req: Request, res: Response): Promise<Response> {
    try {
      const amount = parsePreviewAmount(req.query?.amount);
      const data = service.previewFee(amount);

      return res.status(200).json({ message: "Success", data });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async initialize(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateInitializePayload(req.body);
      const result = await service.initialize(getActorUserId(req), payload);

      return res.status(201).json({
        message: "Payment started",
        data: result,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async retry(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateRetryPayload(req.body);
      const result = await service.retry(getActorUserId(req), payload);

      return res.status(201).json({
        message: "Payment started",
        data: result,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async remove(req: Request, res: Response): Promise<Response> {
    try {
      const reference = parseReferenceQuery(req.query?.reference);
      const data = await service.deleteOwn(getActorUserId(req), reference);

      return res.status(200).json({ message: "Contribution removed", data });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async verify(req: Request, res: Response): Promise<Response> {
    try {
      const reference = req.params?.reference?.trim();

      if (!reference) {
        throw new FinanceHttpError(400, "Invalid reference parameter");
      }

      const data = await service.verify(getActorUserId(req), reference);

      return res.status(200).json({ message: "Success", data });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async listMine(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const result = await service.listForUser(getActorUserId(req), pagination);

      return res
        .status(200)
        .json(
          buildEnvelope(result.data, result.total, pagination.page, pagination.take),
        );
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async listAll(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const filters = parseContributionFilters(
        req.query as Record<string, unknown>,
      );
      const result = await service.listAll(pagination, filters);

      return res
        .status(200)
        .json(
          buildEnvelope(result.data, result.total, pagination.page, pagination.take),
        );
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  /**
   * Public route. Authenticated by HMAC signature over the raw request body,
   * not by a bearer token.
   *
   * This is the ONLY Paystack webhook receiver in the app: index.ts retains the
   * raw body for this path alone, so a second endpoint could not verify a
   * signature. Events are dispatched to the right settlement path by reference
   * prefix, which is why this calls the shared dispatcher rather than the
   * giving service directly.
   *
   * A valid signature answers 200 for every expected outcome, including an
   * unknown reference, an already-settled contribution, or a non-success
   * status - the service handles all of those quietly, without throwing, so
   * they never reach the catch below. Only a genuine infrastructure failure
   * (a dropped DB connection, a deadlock, a timeout) reaches that catch, and
   * that answers 500 instead, so Paystack retries rather than treating the
   * event as consumed.
   */
  async webhook(req: Request, res: Response): Promise<Response> {
    try {
      const valid = await verifyPaystackSignature(
        req.rawBody,
        req.headers["x-paystack-signature"],
      );

      if (!valid) {
        return res.status(401).json({ message: "Invalid signature", data: null });
      }
    } catch (error) {
      // The secret key is unset. A 401 would tell Paystack the event was
      // permanently rejected and it would stop retrying, losing genuine
      // payments during a misconfiguration window. A 500 makes it retry.
      if (error instanceof PaystackConfigError) {
        logger.error("[giving] webhook cannot verify: Paystack is not configured");

        return res
          .status(500)
          .json({ message: "Webhook verification unavailable", data: null });
      }

      throw error;
    }

    try {
      await handlePaystackChargeEvent(req.body);
    } catch (error) {
      // Only infrastructure failures reach here - every expected outcome
      // (unknown reference, already settled, non-success status) returns
      // quietly from the settlement path without throwing. Answering 200 would
      // consume Paystack's only retry and strand a paid contribution at
      // pending, so let it retry instead.
      logger.error("[paystack] webhook processing failed", {
        message: error instanceof Error ? error.message : String(error),
      });

      return res
        .status(500)
        .json({ message: "Webhook processing failed", data: null });
    }

    return res.status(200).json({ message: "Received", data: null });
  }
}
