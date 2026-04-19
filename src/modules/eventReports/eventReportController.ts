import { Request, Response } from "express";
import {
  generateEventReport,
  generateServiceSummaryReport,
  getEventReportDetail,
  getEventReportOverview,
  listEligibleEventReports,
} from "./eventReportService";

export const listEligibleEventReportsHandler = async (
  req: Request,
  res: Response,
) => {
  const data = await listEligibleEventReports();
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
