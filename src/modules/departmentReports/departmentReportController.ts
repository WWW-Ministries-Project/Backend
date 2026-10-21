import { Request, Response } from "express";

import { UnauthorizedError } from "../../utils/custom-error-handlers";
import {
  addComment,
  approveReport,
  decideRequest,
  executiveSummary,
  getReport,
  listReports,
  loadViewer,
  returnReport,
  saveCommentary,
  sendReminder,
  submitReport,
} from "./departmentReportService";

const viewerOf = async (req: Request) => {
  const id = Number((req as any).user?.id);
  if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedError("Authenticated user not found");
  return loadViewer(id);
};

const query = (req: Request) => req.query as Record<string, unknown>;
const body = (req: Request) => ({ ...(req.query as Record<string, unknown>), ...(req.body || {}) });

export const listDepartmentReportsHandler = async (req: Request, res: Response) => {
  res.json({ message: "Operation successful", data: await listReports(await viewerOf(req), query(req)) });
};

export const getDepartmentReportHandler = async (req: Request, res: Response) => {
  res.json({ message: "Operation successful", data: await getReport(await viewerOf(req), query(req)) });
};

export const executiveSummaryHandler = async (req: Request, res: Response) => {
  res.json({ message: "Operation successful", data: await executiveSummary(await viewerOf(req), query(req)) });
};

export const saveCommentaryHandler = async (req: Request, res: Response) => {
  res.json({ message: "Draft saved", data: await saveCommentary(await viewerOf(req), body(req)) });
};

export const submitReportHandler = async (req: Request, res: Response) => {
  res.json({ message: "Submitted to leadership", data: await submitReport(await viewerOf(req), body(req)) });
};

export const approveReportHandler = async (req: Request, res: Response) => {
  res.json({ message: "Report approved", data: await approveReport(await viewerOf(req), body(req)) });
};

export const returnReportHandler = async (req: Request, res: Response) => {
  res.json({ message: "Report returned", data: await returnReport(await viewerOf(req), body(req)) });
};

export const addCommentHandler = async (req: Request, res: Response) => {
  res.json({ message: "Comment posted", data: await addComment(await viewerOf(req), body(req)) });
};

export const sendReminderHandler = async (req: Request, res: Response) => {
  res.json({ message: "Reminder sent", data: await sendReminder(await viewerOf(req), body(req)) });
};

export const decideRequestHandler = async (req: Request, res: Response) => {
  res.json({ message: "Decision saved", data: await decideRequest(await viewerOf(req), body(req)) });
};
