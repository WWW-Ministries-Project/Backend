import { Router } from "express";
import { uploadImage } from "../uploadFile/uploads";
import multer from "multer";
import { Permissions } from "../../middleWare/authorization";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const maxUploadSizeBytes = Number(
  process.env.MAX_UPLOAD_SIZE_BYTES || 5 * 1024 * 1024,
);

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: maxUploadSizeBytes,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Unsupported file type"));
    }
    return cb(null, true);
  },
});
const permissions = new Permissions();
const protect = permissions.protect;

export const uploadRouter = Router();
uploadRouter.post("/", [protect, upload.single("file")], uploadImage);
