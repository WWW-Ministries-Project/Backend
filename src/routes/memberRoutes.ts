import Router from "express";
import * as dotenv from "dotenv";
import { createMember, getAllMembers } from "../controllers/memberController";
dotenv.config();
export const memberrouter = Router();

memberrouter.post("/create-member", createMember);

memberrouter.get("/all", getAllMembers);
