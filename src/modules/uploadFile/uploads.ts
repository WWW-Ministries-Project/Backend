import fs from "fs/promises";
import { uploadLocalFileToS3 } from "../../utils";

export const uploadImage = async (req: any, res: any) => {
  const filePath = req?.file?.path;
  const originalName = req?.file?.originalname;
  const contentType = req?.file?.mimetype;
  if (!filePath) {
    return res.status(400).json({
      message: "No file uploaded",
      result: null,
    });
  }

  try {
    const result = await uploadLocalFileToS3({
      filePath,
      folder: "www-ministires/uploads",
      originalName,
      contentType,
      baseName: "upload",
    });

    await fs.unlink(filePath).catch(() => undefined);

    return res.status(200).json({
      message: "File uploaded successfully",
      result: {
        link: result.url,
      },
    });
  } catch (error) {
    await fs.unlink(filePath).catch(() => undefined);
    return res.status(400).json({
      message: "Error uploading file",
      error: error instanceof Error ? error.message : "Upload failed",
    });
  }
};
