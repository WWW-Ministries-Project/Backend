import { Request, Response } from "express";
import { CohortService } from "./cohortService";

const cohortService = new CohortService();

export class CohortController {
  async createCohort(req: Request, res: Response) {
    try {
      console.log(req.body);
      const newCohort = await cohortService.createCohort(
        req.body.programId,
        req.body,
      );
      return res
        .status(201)
        .json({ message: "Cohort created", data: newCohort });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error creating program", error: error.message });
    }
  }
  async getAllCohortsByProgramID(req: Request, res: Response) {
    try {
      const cohorts = await cohortService.getAllCohortsByProgramID(
        Number(req.query.id),
      );
      return res.status(200).json({ data: cohorts });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching cohort", error: error.message });
    }
  }

  async getAllCohorts(req: Request, res: Response) {
    try {
      const cohorts = await cohortService.getAllCohorts();
      return res.status(200).json({ data: cohorts });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching cohort", error: error.message });
    }
  }

  async getCohortsById(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const cohort = await cohortService.getCohortById(Number(id));
      if (!cohort) return res.status(404).json({ message: "Cohort not found" });

      return res.status(200).json({ data: cohort });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching cohort", error: error.message });
    }
  }

  async updateChort(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const updatedProgram = await cohortService.updateCohort(
        Number(id),
        req.body,
      );
      return res
        .status(200)
        .json({ message: "Cohort updated", data: updatedProgram });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error updating cohort", error: error.message });
    }
  }

  async deleteCohort(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await cohortService.deleteCohort(Number(id));
      return res.status(200).json({ message: "Cohort deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting cohort", error: error.message });
    }
  }
}
