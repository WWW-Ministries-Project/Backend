import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";
import { VisitorService } from "./visitorService";

const visitorService = new VisitorService();

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isVisitorValidationError = (error: unknown) =>
  error instanceof InputValidationError;

const isVisitorRecordNotFoundError = (error: unknown) =>
  error instanceof NotFoundError ||
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025");

export class VisitorController {
  async createVisitor(req: Request, res: Response) {
    try {
      const newVisitor = await visitorService.createVisitor(req.body);
      return res
        .status(201)
        .json({ message: "Visitor Added", data: newVisitor });
    } catch (error: unknown) {
      if (isVisitorValidationError(error)) {
        return res
          .status(400)
          .json({
            message: "Please correct the visitor details and try again.",
            error: getErrorMessage(
              error,
              "Please review the visitor details and try again.",
            ),
          });
      }

      return res
        .status(500)
        .json({
          message: "Error creating visitor",
          error: getErrorMessage(
            error,
            "We could not save the visitor right now. Please try again.",
          ),
        });
    }
  }

  async getAllVisitors(req: Request, res: Response) {
    try {
      const queryParams = req.query as any;
      const visitorScope = (req as any).visitorScope;
      const programs = await visitorService.getAllVisitors(
        queryParams,
        visitorScope,
      );
      return res.status(200).json({ data: programs });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching visitors", error: error.message });
    }
  }

  async getVisitorsById(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const visitor = await visitorService.getVisitorById(Number(id));
      if (!visitor)
        return res.status(404).json({ message: "Visitor not found" });

      return res.status(200).json({ data: visitor });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching visitor", error: error.message });
    }
  }

  async updateVisitor(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const updatedProgram = await visitorService.updateVisitor(
        Number(id),
        req.body,
      );
      return res
        .status(200)
        .json({ message: "Visitor updated", data: updatedProgram });
    } catch (error: unknown) {
      if (isVisitorValidationError(error)) {
        return res
          .status(400)
          .json({
            message: "Please correct the visitor details and try again.",
            error: getErrorMessage(
              error,
              "Please review the visitor details and try again.",
            ),
          });
      }

      if (isVisitorRecordNotFoundError(error)) {
        return res.status(404).json({
          message: "Visitor not found",
          error:
            "We could not find the visitor you are trying to update. Refresh the page and try again.",
        });
      }

      return res
        .status(500)
        .json({
          message: "Error updating visitor",
          error: getErrorMessage(
            error,
            "We could not update the visitor right now. Please try again.",
          ),
        });
    }
  }

  async deleteVisitor(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await visitorService.deleteVisitor(Number(id));
      return res.status(200).json({ message: "Visitor deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting visitor", error: error.message });
    }
  }

  async convertVisitorToMember(req: Request, res: Response) {
    try {
      const queryVisitorId = Number(req.query?.id);
      const bodyVisitorId = Number(req.body?.source_visitor_id);
      const resolvedVisitorId =
        Number.isInteger(queryVisitorId) && queryVisitorId > 0
          ? queryVisitorId
          : Number.isInteger(bodyVisitorId) && bodyVisitorId > 0
            ? bodyVisitorId
            : null;

      if (!resolvedVisitorId) {
        return res
          .status(400)
          .json({ message: "Invalid or missing visitor id" });
      }

      const user = await visitorService.changeVisitorStatusToMember(
        resolvedVisitorId,
        req.body,
      );

      return res.status(200).json({
        message: "Visitor converted to member successfully",
        data: user,
      });
    } catch (error: unknown) {
      if (isVisitorValidationError(error)) {
        return res.status(400).json({
          message: "Please correct the member details and try again.",
          error: getErrorMessage(
            error,
            "Please review the member details and try again.",
          ),
        });
      }

      if (isVisitorRecordNotFoundError(error)) {
        return res.status(404).json({
          message: "Visitor not found",
          error:
            "We could not find the visitor you are trying to convert. Refresh the page and try again.",
        });
      }

      if (
        String(getErrorMessage(error, "")).startsWith(
          "A user with the email ",
        )
      ) {
        return res.status(409).json({
          message: "A member account with this email already exists.",
          error:
            "Use a different email address or sign in with the existing account.",
        });
      }

      return res.status(500).json({
        message: "Error converting visitor to member",
        error: getErrorMessage(
          error,
          "We could not convert the visitor to a member right now. Please try again.",
        ),
      });
    }
  }
}
