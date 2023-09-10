import Router from "express";
import * as dotenv from "dotenv";
import {
  createMember,
  getAllMembers,
  updateMemberInfo,
} from "../controllers/memberController";
dotenv.config();
export const memberrouter = Router();

memberrouter.post("/create-member", createMember);

memberrouter.post("/update-member", updateMemberInfo);

memberrouter.get("/all", getAllMembers);
