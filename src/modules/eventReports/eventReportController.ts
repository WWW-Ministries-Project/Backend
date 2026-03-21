import { Request, Response } from "express";
import {
  churchAttendanceApprovalAction,
  fetchEventReportApprovalConfig,
  finalApprovalAction,
  financeApprovalAction,
  getEventReportDetail,
  saveEventReportApprovalConfig,
  submitEventReportForFinalApproval,
  upsertEventReportFinance,
} from "./eventReportService";

export const saveEventReportApprovalConfigHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await saveEventReportApprovalConfig(req.body, (req as any).user?.id);
  res.status(200).json({
    message: "Saved successfully",
    data,
  });
};

export const getEventReportApprovalConfigHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await fetchEventReportApprovalConfig();
  res.status(200).json({
    message: "Operation successful",
    data,
  });
};

export const getEventReportDetailHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await getEventReportDetail(req.query, (req as any).user);
  res.status(200).json({
    message: "Operation successful",
    ...data,
  });
};

export const upsertEventReportFinanceHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await upsertEventReportFinance(req.body, (req as any).user);
  res.status(200).json({
    message: "Finance updated successfully",
    ...data,
  });
};

export const churchAttendanceApprovalActionHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await churchAttendanceApprovalAction(req.body, (req as any).user);
  res.status(200).json({
    message: "Church attendance approval updated successfully",
    ...data,
  });
};

export const financeApprovalActionHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await financeApprovalAction(req.body, (req as any).user);
  res.status(200).json({
    message: "Finance approval updated successfully",
    ...data,
  });
};

export const submitFinalApprovalHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await submitEventReportForFinalApproval(req.body, (req as any).user);
  res.status(200).json({
    message: "Submitted for final approval successfully",
    ...data,
  });
};

export const finalApprovalActionHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await finalApprovalAction(req.body, (req as any).user);
  res.status(200).json({
    message: "Final approval action processed successfully",
    ...data,
  });
};
