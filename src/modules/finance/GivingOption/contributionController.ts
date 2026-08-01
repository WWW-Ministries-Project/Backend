import { Request, Response } from "express";
import { PaystackConfigError } from "../../../libs/paystack/paystackCredentials";
import { verifyPaystackSignature } from "../../../libs/paystack/paystackWebhook";
import { FinanceHttpError, parsePagination, sendFinanceError } from "../common";
import { GivingContributionService } from "./contributionService";
import {
  parseContributionFilters,
  validateInitializePayload,
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
   * Once the signature checks out this always answers 200, including for
   * references we do not recognise - anything else makes Paystack retry
   * indefinitely for a payment we will never match.
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
        console.error("[giving] webhook cannot verify: Paystack is not configured");

        return res
          .status(500)
          .json({ message: "Webhook verification unavailable", data: null });
      }

      throw error;
    }

    try {
      await service.handleWebhook(req.body);
    } catch (error) {
      console.error("[giving] webhook processing failed", error);
    }

    return res.status(200).json({ message: "Received", data: null });
  }
}
