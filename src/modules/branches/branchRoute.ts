import Router from "express";
import {
  createBranch,
  deleteBranch,
  listBranches,
  updateBranch,
} from "./branchController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();

export const branchRouter = Router();

branchRouter.get("/list-branches", permissions.protect, listBranches);
branchRouter.post("/create-branch", permissions.protect, createBranch);
branchRouter.put("/update-branch", permissions.protect, updateBranch);
branchRouter.delete("/delete-branch", permissions.protect, deleteBranch);
