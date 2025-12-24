import { Request, Response } from "express";
import { ProgramService } from "./programService";

const programService = new ProgramService();
export class ProgramController {
  async createProgram(req: Request, res: Response) {
    try {
      const newProgram = await programService.createProgram(req.body);
      return res
        .status(201)
        .json({ message: "Program created", data: newProgram });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error creating program", error: error.message });
    }
  }

  async getAllPrograms(req: Request, res: Response) {
    try {
      const programs = await programService.getAllPrograms();
      return res.status(200).json({ data: programs });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching programs", error: error.message });
    }
  }

  async getProgramById(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const program = await programService.getProgramById(Number(id));
      if (!program)
        return res.status(404).json({ message: "Program not found" });

      return res.status(200).json({ data: program });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching program", error: error.message });
    }
  }

  async updateProgram(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const updatedProgram = await programService.updateProgram(
        Number(id),
        req.body,
      );
      return res
        .status(200)
        .json({ message: "Program updated", data: updatedProgram });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error updating program", error: error.message });
    }
  }

  async deleteProgram(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await programService.deleteProgram(Number(id));
      return res.status(200).json({ message: "Program deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting program", error: error.message });
    }
  }

  async createTopic(req: Request, res: Response) {
    try {
      const { programId, name, description, learningUnit } = req.body;
      await programService.createTopic(programId, name, description, learningUnit);
      return res.status(200).json({ message: "Topic created successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error creating program", error: error.message });
    }
  }
  async updateTopic(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const { name, description, learningUnit } = req.body;
      await programService.updateTopic(Number(id), name, description, learningUnit);
      return res.status(200).json({ message: "Topic update successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error updating program", error: error.message });
    }
  }

  async deleteTopic(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await programService.deleteTopic(Number(id));
      return res.status(200).json({ message: "Topic deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting topicc", error: error.message });
    }
  }

  async getAllProgramForMember(req: Request, res: Response) {
    try {
      const programs = await programService.getAllProgramForMember();
      return res
        .status(200)
        .json({ message: "Program successfully", data: programs });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting topicc", error: error.message });
    }
  }

  async getTopic(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const topic = await programService.getTopic(Number(id));
      return res
        .status(200)
        .json({ message: "Program successfully", data: topic });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting topicc", error: error.message });
    }

  }
}
