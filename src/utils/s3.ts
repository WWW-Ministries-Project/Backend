import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

const s3BucketName = String(
  process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || "",
).trim();
const s3Region =
  String(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-north-1")
    .trim() || "eu-north-1";
const s3PublicBaseUrl = String(
  process.env.S3_PUBLIC_BASE_URL ||
    (s3BucketName
      ? `https://${s3BucketName}.s3.${s3Region}.amazonaws.com`
      : ""),
)
  .trim()
  .replace(/\/+$/, "");

const accessKeyId = String(process.env.AWS_ACCESS_KEY_ID || "").trim();
const secretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY || "").trim();

const s3Client = new S3Client({
  region: s3Region,
  credentials:
    accessKeyId && secretAccessKey
      ? {
          accessKeyId,
          secretAccessKey,
        }
      : undefined,
});

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "application/msword": ".doc",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "-"))
    .filter(Boolean)
    .join("/");

const ensureS3Config = () => {
  if (!s3BucketName) {
    throw new Error("S3 bucket name is not configured");
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("S3 credentials are not configured");
  }
};

const buildPublicUrl = (key: string) => {
  if (!s3PublicBaseUrl) {
    throw new Error("S3 public base URL is not configured");
  }

  const encodedKey = key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${s3PublicBaseUrl}/${encodedKey}`;
};

const resolveExtension = (originalName?: string, contentType?: string) => {
  const originalExtension = path.extname(String(originalName || "").trim());
  if (originalExtension) {
    return originalExtension.toLowerCase();
  }

  return MIME_TYPE_TO_EXTENSION[String(contentType || "").trim()] || "";
};

const buildObjectKey = (args: {
  folder?: string;
  originalName?: string;
  baseName?: string;
  contentType?: string;
}) => {
  const folder = sanitizePathSegment(String(args.folder || ""));
  const extension = resolveExtension(args.originalName, args.contentType);
  const baseNameSource = path.parse(String(args.originalName || "").trim()).name;
  const safeBaseName =
    sanitizePathSegment(baseNameSource) ||
    sanitizePathSegment(String(args.baseName || "")) ||
    "upload";
  const filename = `${safeBaseName}-${randomUUID()}${extension}`;

  return [folder, filename].filter(Boolean).join("/");
};

type UploadBufferToS3Args = {
  buffer: Buffer;
  folder?: string;
  originalName?: string;
  baseName?: string;
  contentType?: string;
};

export const uploadBufferToS3 = async (args: UploadBufferToS3Args) => {
  ensureS3Config();

  const key = buildObjectKey(args);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3BucketName,
      Key: key,
      Body: args.buffer,
      ContentType: args.contentType || undefined,
    }),
  );

  return {
    key,
    url: buildPublicUrl(key),
  };
};

type UploadLocalFileToS3Args = {
  filePath: string;
  folder?: string;
  originalName?: string;
  baseName?: string;
  contentType?: string;
};

export const uploadLocalFileToS3 = async (args: UploadLocalFileToS3Args) => {
  const buffer = await fs.readFile(args.filePath);

  return uploadBufferToS3({
    buffer,
    folder: args.folder,
    originalName: args.originalName,
    baseName: args.baseName,
    contentType: args.contentType,
  });
};

type UploadDataUrlToS3Args = {
  folder?: string;
  originalName?: string;
  baseName?: string;
};

export const uploadDataUrlToS3 = async (
  dataUrl: string,
  args: UploadDataUrlToS3Args = {},
) => {
  const match = String(dataUrl || "").match(DATA_URL_PATTERN);
  if (!match) {
    throw new Error("Invalid data URL");
  }

  const [, contentType, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");

  return uploadBufferToS3({
    buffer,
    folder: args.folder,
    originalName: args.originalName,
    baseName: args.baseName,
    contentType,
  });
};

const decodeKey = (value: string) =>
  value
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");

export const getS3ObjectKeyFromUrl = (objectUrl: string): string | null => {
  if (!objectUrl) return null;

  try {
    const parsedUrl = new URL(objectUrl);
    const normalizedPath = parsedUrl.pathname.replace(/^\/+/, "");
    const bucketPrefix = `${s3BucketName}/`;

    if (s3PublicBaseUrl && objectUrl.startsWith(`${s3PublicBaseUrl}/`)) {
      return decodeKey(normalizedPath);
    }

    if (
      parsedUrl.hostname === `${s3BucketName}.s3.${s3Region}.amazonaws.com` ||
      parsedUrl.hostname === `${s3BucketName}.s3.amazonaws.com`
    ) {
      return decodeKey(normalizedPath);
    }

    if (
      (parsedUrl.hostname === `s3.${s3Region}.amazonaws.com` ||
        parsedUrl.hostname === "s3.amazonaws.com") &&
      normalizedPath.startsWith(bucketPrefix)
    ) {
      return decodeKey(normalizedPath.slice(bucketPrefix.length));
    }

    return null;
  } catch (error) {
    return null;
  }
};

export const deleteS3ObjectByUrl = async (objectUrl: string) => {
  const key = getS3ObjectKeyFromUrl(objectUrl);
  if (!key) {
    return false;
  }

  ensureS3Config();

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: s3BucketName,
      Key: key,
    }),
  );

  return true;
};
