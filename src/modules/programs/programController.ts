import { Request, Response } from "express";
import { ProgramService } from "./programService";

const programService = new ProgramService();
export class ProgramController {
  async reorderTopics(req: Request, res: Response) {
    try {
      const { programId, topics } = req.body;

      if (!Number.isInteger(programId) || programId <= 0) {
        return res.status(400).json({
          success: false,
          message: "programId must be a positive integer",
        });
      }

      if (!Array.isArray(topics) || topics.length === 0) {
        return res.status(400).json({
          success: false,
          message: "topics must be a non-empty array",
        });
      }

      const hasInvalidTopicPayload = topics.some(
        (topic: any) =>
          !Number.isInteger(topic?.id) ||
          topic.id <= 0 ||
          !Number.isInteger(topic?.order_number) ||
          topic.order_number <= 0,
      );

      if (hasInvalidTopicPayload) {
        return res.status(400).json({
          success: false,
          message:
            "Each topic must include a positive integer id and order_number",
        });
      }

      const topicIds = topics.map((topic: any) => topic.id);
      const orderNumbers = topics.map((topic: any) => topic.order_number);

      if (new Set(topicIds).size !== topicIds.length) {
        return res.status(400).json({
          success: false,
          message: "topics must not contain duplicate ids",
        });
      }

      if (new Set(orderNumbers).size !== orderNumbers.length) {
        return res.status(400).json({
          success: false,
          message: "topics must not contain duplicate order_number values",
        });
      }

      const result = await programService.reorderTopics(programId, topics);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error?.message === "Program not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error?.message?.startsWith("Topics not found in program:")) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Error reordering topics",
        error: error.message,
      });
    }
  }

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
      const pageRaw = req.query.page;
      const takeRaw = req.query.take;

      let page: number | undefined;
      let take: number | undefined;
      if (pageRaw !== undefined || takeRaw !== undefined) {
        const parsedPage = Number(pageRaw ?? 1);
        const parsedTake = Number(takeRaw ?? 10);

        if (
          !Number.isInteger(parsedPage) ||
          parsedPage <= 0 ||
          !Number.isInteger(parsedTake) ||
          parsedTake <= 0
        ) {
          return res.status(400).json({
            message: "Invalid page/take. Both must be positive integers.",
          });
        }

        page = parsedPage;
        take = parsedTake;
      }

      const programs = await programService.getAllPrograms({ page, take });
      return res.status(200).json({ data: programs });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching programs", error: error.message });
    }
  }

  async getAllProgramsFullDetailsWithEnrollments(req: Request, res: Response) {
    try {
      const programs =
        await programService.getAllProgramsWithEnrolledMembersAndCompletion();
      return res.status(200).json({ data: programs });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching full programs with enrollment status",
        error: error.message,
      });
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
      const rawUserId = req.query.userId;
      let userId: number | undefined = undefined;

      if (rawUserId !== undefined) {
        userId = Number(rawUserId);
        if (!Number.isInteger(userId) || userId <= 0) {
          return res.status(400).json({
            message: "userId must be a positive integer",
          });
        }
      }

      const programs = await programService.getAllProgramForMember(userId);
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

      if (
        !Number.isInteger(Number(userId)) ||
        Number(userId) <= 0 ||
        !Number.isInteger(Number(programId)) ||
        Number(programId) <= 0 ||
        !Number.isInteger(Number(topicId)) ||
        Number(topicId) <= 0
      ) {
        return res.status(400).json({
          message: "userId, programId and topicId must be positive integers",
        });
      }

      if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        return res.status(400).json({
          message: "answers must be a key-value object",
        });
      }

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
      const notFoundErrors = [
        "No MCQ assignment found for this topic",
        "User is not enrolled in this program",
      ];

      const badRequestErrors = [
        "Topic does not belong to the provided program",
        "Assignment questions are not configured",
      ];

      const forbiddenErrors = [
        "Assignment has not been activated for your cohort",
        "Assignment is not active for your cohort",
        "Assignment due date has passed",
      ];

      if (notFoundErrors.includes(error?.message)) {
        return res.status(404).json({
          message: error.message,
          error: error.message,
        });
      }

      if (badRequestErrors.includes(error?.message)) {
        return res.status(400).json({
          message: error.message,
          error: error.message,
        });
      }

      if (forbiddenErrors.includes(error?.message)) {
        return res.status(403).json({
          message: error.message,
          error: error.message,
        });
      }

      if (error?.message?.startsWith("Maximum attempts of")) {
        return res.status(409).json({
          message: error.message,
          error: error.message,
        });
      }

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
      const assignments = await programService.getAssignmentsForCohort(
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
