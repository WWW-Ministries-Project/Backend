import { cloudinary } from "../../utils";
import fs from "fs/promises";

export const uploadImage = async (req: any, res: any) => {
  const filePath = req?.file?.path;
  if (!filePath) {
    return res.status(400).json({
      message: "No file uploaded",
      result: null,
    });
  }

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: "www-ministires",
      quality: "auto",
    });

    await fs.unlink(filePath).catch(() => undefined);

    return res.status(200).json({
      message: "File uploaded successfully",
      result: {
        link: result.secure_url,
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
