import { Request, Response } from "express";

import { UnauthorizedError } from "../../utils/custom-error-handlers";
import { getWorkspace } from "./workspaceService";

export const getWorkspaceHandler = async (req: Request, res: Response) => {
  const id = Number((req as any).user?.id);
  if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedError("Authenticated user not found");
  res.json({
    message: "Operation successful",
    data: await getWorkspace(id, req.params.ws, req.query as Record<string, unknown>),
  });
};
