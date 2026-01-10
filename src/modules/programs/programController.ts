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
      const topic = await programService.createTopic(
        programId,
        name,
        description,
        learningUnit,
      );
      return res
        .status(200)
        .json({ message: "Topic created successfully", data: topic });
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
      await programService.updateTopic(
        Number(id),
        name,
        description,
        learningUnit,
      );
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
        .json({ message: "Error deleting topic", error: error.message });
    }
  }
  async getAllTopics(req: Request, res: Response) {
    try {
      const topics = await programService.getAllTopics();
      return res
        .status(200)
        .json({ message: "Topics fetched successfully", data: topics });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching topics", error: error.message });
    }
  }
  async completeTopic(req: Request, res: Response) {
    try {
      const { topicId, userId } = req.body;
      const progres = await programService.completeTopicByUserAndTopic(
        Number(userId),
        Number(topicId),
      );

      return res
        .status(200)
        .json({ message: "Topic completed successfully", data: progres });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error completing topic", error: error.message });
    }
  }

  async getUserProgramCompletionStatus(req: Request, res: Response) {
    try {
      const programId = Number(req.query.programId);
      const userId = Number(req.query.userId);

      if (!programId || !userId) {
        return res.status(400).json({
          message: "programId and userId are required",
        });
      }

      const status =
        await programService.getUserProgramWithProgressAndLearningUnit(
          userId,
          programId,
        );

      return res.status(200).json({
        message: "Program status fetched",
        data: status,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching program status",
        error: error.message,
      });
    }
  }

  async getProgramsByinstructor(req: Request, res: Response) {
    try {
      const { instructorId } = req.query;
      const programs = await programService.getProgramsByInstructor(
        Number(instructorId),
      );
      return res
        .status(200)
        .json({ message: "Programs fetched", data: programs });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching programs", error: error.message });
    }
  }

  async getCohortsByProgram(req: Request, res: Response) {
    try {
      const { programId } = req.query;
      const cohorts = await programService.getCohortsByProgram(
        Number(programId),
      );
      return res
        .status(200)
        .json({ message: "Cohorts fetched", data: cohorts });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching cohorts", error: error.message });
    }
  }

  async activateCohortAssignment(req: Request, res: Response) {
    try {
      const { cohortId, topicId, dueDate } = req.body;
      await programService.activateAssignmentForCohort(
        Number(cohortId),
        Number(topicId),
        dueDate,
      );
      return res
        .status(200)
        .json({ message: "Cohort assignment activated successfully" });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error activating cohort assignment",
        error: error.message,
      });
    }
  }

  async deactivateCohortAssignment(req: Request, res: Response) {
    try {
      const { cohortId, topicId } = req.body;
      await programService.deactivateAssignmentForCohort(
        Number(cohortId),
        Number(topicId),
      );
      return res
        .status(200)
        .json({ message: "Cohort assignment deactivated successfully" });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error deactivating cohort assignment",
        error: error.message,
      });
    }
  }

  async isAssignmentActiveForCohort(req: Request, res: Response) {
    try {
      const { cohortId, topicId } = req.query;
      const isActive = await programService.isAssignmentActiveForCohort(
        Number(cohortId),
        Number(topicId),
      );
      return res.status(200).json({
        message: "Cohort assignment status fetched successfully",
        data: { isActive },
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching cohort assignment status",
        error: error.message,
      });
    }
  }

  async submitMCQAssignment(req: Request, res: Response) {
    try {
      const { userId, programId, topicId, answers } = req.body;
      const result = await programService.submitMCQAssignment(
        Number(userId),
        Number(programId),
        Number(topicId),
        answers,
      );
      return res
        .status(200)
        .json({ message: "MCQ Assignment submitted", data: result });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error submitting MCQ assignment",
        error: error.message,
      });
    }
  }

  async getAssignmentResults(req: Request, res: Response) {
    try {
      const { topicId, cohortId, programId } = req.query;
      const filters: { cohortId?: number; programId?: number } = {};
      if (cohortId) filters.cohortId = Number(cohortId);
      if (programId) filters.programId = Number(programId);

      const results = await programService.getAssignmentResults(
        Number(topicId),
        filters,
      );
      return res
        .status(200)
        .json({ message: "Assignment results fetched", data: results });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching assignment results",
        error: error.message,
      });
    }
  }

  async getAssignmentsByCohort(req: Request, res: Response) {
    try {
      const { cohortId } = req.query;
      const assignments = await programService.getAssignmentsByCohort(
        Number(cohortId),
      );
      return res
        .status(200)
        .json({ message: "Assignments fetched", data: assignments });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching assignments", error: error.message });
    }
  } 
}
