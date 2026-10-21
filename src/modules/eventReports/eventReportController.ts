import { Request, Response } from "express";
import {
  generateEventReport,
  generateServiceSummaryReport,
  getEventReportDetail,
  getEventReportOverview,
  listEligibleEventReports,
} from "./eventReportService";
import {
  getApprovalConfigByModule,
  upsertRequisitionApprovalConfig,
} from "../requisitions/requisition-approval-workflow";

/** Event report sign-off settings. Stored with the requisition approval configs. */
export const getEventReportApprovalConfigHandler = async (
  _req: Request,
  res: Response,
) => {
  const data = await getApprovalConfigByModule("EVENT_REPORT");
  res.status(200).json({
    message: "Operation successful",
    data,
  });
};

export const saveEventReportApprovalConfigHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await upsertRequisitionApprovalConfig(
    {
      ...req.body,
      module: "EVENT_REPORT",
      requester_user_ids: [],
    },
    (req as any).user?.id,
  );
  res.status(200).json({
    message: "Saved successfully",
    data,
  });
};

export const listEligibleEventReportsHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await listEligibleEventReports(req.query);
  res.status(200).json({
    message: "Operation successful",
    ...data,
  });
};

export const generateEventReportHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await generateEventReport(req.body, (req as any).user);
  res.status(200).json({
    message: "Report generated successfully",
    ...data,
  });
};

export const getEventReportOverviewHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await getEventReportOverview(req.query);
  res.status(200).json({
    message: "Operation successful",
    ...data,
  });
};

export const getEventReportDetailHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await getEventReportDetail(req.query);
  res.status(200).json({
    message: "Operation successful",
    ...data,
  });
};

export const generateServiceSummaryReportHandler = async (
  req: Request,
  res: Response,
) => {
  const file = await generateServiceSummaryReport({
    ...req.body,
    format: req.query.format ?? req.body?.format,
  });
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename=\"${file.fileName}\"`);
  res.status(200).send(file.buffer);
};
