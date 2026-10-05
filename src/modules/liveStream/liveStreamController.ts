import { Request, Response } from "express";
import { liveStreamService } from "./liveStreamService";

export const getLiveStreamStatus = async (_req: Request, res: Response) => {
  const data = await liveStreamService.getLiveStreamStatus();

  res.status(200).json({
    message: "Live stream status retrieved successfully",
    data,
  });
};
