import Router from "express";

import { Permissions } from "../../middleWare/authorization";
import { getWorkspaceHandler } from "./workspaceController";

/**
 * Home workspaces. Which workspaces a caller may open comes from their role in
 * the selected branch; per-widget access is checked in the builders.
 * Contract: Frontend/docs/WORKSPACES_AND_REPORT_CONFIG_BACKEND_CONTRACT.md
 */
export const workspaceRouter = Router();
const permissions = new Permissions();

workspaceRouter.get("/:ws", [permissions.protect], getWorkspaceHandler);
