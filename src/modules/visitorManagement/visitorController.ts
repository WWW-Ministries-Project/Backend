import { Request, Response } from "express";
import { VisitorService } from "./visitorService";

const visitorService = new VisitorService();

export class VisitorController {
  async createVisitor(req: Request, res: Response) {
    try {
      const newVisitor = await visitorService.createVisitor(req.body);
      return res
        .status(201)
        .json({ message: "Visitor Added", data: newVisitor });
    } catch (error: any) {
      if (String(error?.message || "").includes("responsibleMembers")) {
        return res
          .status(400)
          .json({ message: "Error creating visitor", error: error.message });
      }

      return res
        .status(500)
        .json({ message: "Error creating visitor", error: error.message });
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
    } catch (error: any) {
      if (String(error?.message || "").includes("responsibleMembers")) {
        return res
          .status(400)
          .json({ message: "Error updating visitor", error: error.message });
      }

      return res
        .status(500)
        .json({ message: "Error updating visitor", error: error.message });
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
      const { id } = req.query;

      if (!id || Number.isNaN(Number(id))) {
        return res
          .status(400)
          .json({ message: "Invalid or missing visitor id" });
      }

      const user = await visitorService.changeVisitorStatusToMember(Number(id));

      return res.status(200).json({
        message: "Visitor converted to member successfully",
        data: user,
      });
    } catch (error: any) {
      if (
        error?.message ===
        "A valid non-temporary email is required to convert a visitor to a login user."
      ) {
        return res.status(400).json({
          message: "Error converting visitor to member",
          error: error.message,
        });
      }

      if (String(error?.message || "").startsWith("User exist with this email")) {
        return res.status(409).json({
          message: "Error converting visitor to member",
          error: error.message,
        });
      }

      return res.status(500).json({
        message: "Error converting visitor to member",
        error: error.message,
      });
    }
  }
}
