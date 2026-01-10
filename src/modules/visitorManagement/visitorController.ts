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
      return res
        .status(500)
        .json({ message: "Error creating visitor", error: error.message });
    }
  }

  async getAllVisitors(req: Request, res: Response) {
    try {
      const queryParams = req.query as any;
      const programs = await visitorService.getAllVisitors(queryParams);
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
}
