import { Request, Response } from "express";
import { MemberVisitorService } from "./memberVisitorService";

const memberVisitorService = new MemberVisitorService();

const getRequestUserId = (req: Request) => {
  const parsed = Number((req as any)?.user?.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toPositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const fail = (res: Response, error: any, message: string) => {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    message,
    error: status >= 500 ? "Something went wrong" : error?.message,
  });
};

export class MemberVisitorController {
  async listMyVisitors(req: Request, res: Response) {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }
    try {
      const data = await memberVisitorService.getVisitorsForResponsibleUser(userId);
      return res.status(200).json({ message: "Success", data });
    } catch (error: any) {
      return fail(res, error, "Error fetching visitors");
    }
  }

  async listMyFollowUps(req: Request, res: Response) {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }
    try {
      const visitorId = toPositiveInt(req.query?.visitorId) ?? undefined;
      const data = await memberVisitorService.getFollowUpsForAssignee(userId, visitorId);
      return res.status(200).json({ message: "Success", data });
    } catch (error: any) {
      return fail(res, error, "Error fetching follow-ups");
    }
  }

  async updateMyFollowUp(req: Request, res: Response) {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }
    const id = toPositiveInt(req.body?.id);
    if (!id) {
      return res.status(400).json({ message: "id is required", data: null });
    }
    const { status, notes } = req.body ?? {};
    try {
      const data = await memberVisitorService.updateOwnFollowUp(userId, id, {
        status: typeof status === "string" ? status : undefined,
        notes: typeof notes === "string" ? notes : undefined,
      });
      return res.status(200).json({ message: "Follow-up updated", data });
    } catch (error: any) {
      return fail(res, error, "Error updating follow-up");
    }
  }

  async addMyVisitNote(req: Request, res: Response) {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }
    const visitorId = toPositiveInt(req.body?.visitorId);
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!visitorId || !note) {
      return res
        .status(400)
        .json({ message: "visitorId and note are required", data: null });
    }
    try {
      const data = await memberVisitorService.addVisitNoteForResponsibleUser(
        userId,
        visitorId,
        note,
      );
      return res.status(201).json({ message: "Note added", data });
    } catch (error: any) {
      return fail(res, error, "Error adding note");
    }
  }
}
