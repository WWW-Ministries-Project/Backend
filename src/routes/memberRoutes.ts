import Router from "express";
import * as dotenv from "dotenv";
import {
  createMember,
  dashboardCount,
  getAllMembers,
  updateMemberInfo,
} from "../controllers/memberController";
dotenv.config();
export const memberrouter = Router();

memberrouter.post("/create-member", createMember);

memberrouter.post("/update-member", updateMemberInfo);

memberrouter.get("/all", getAllMembers);

memberrouter.get("/dashboard", dashboardCount);
