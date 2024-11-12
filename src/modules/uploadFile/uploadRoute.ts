import { Router } from "express";
import { uploadImage } from "../uploadFile/uploads";
import multer from "multer";

const upload = multer({ dest: "uploads/" });

export const uploadRouter = Router();
uploadRouter.post("/", upload.single("file"), uploadImage);
