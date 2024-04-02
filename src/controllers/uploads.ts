import cloudinary from "../utils/cloudinary";

export const uploadImage = async (req: any, res: any) => {
  const file = req.file.path;
  cloudinary.uploader.upload(
    file,
    { folder: "www-ministires", quality: "auto" },
    (err: any, result: any) => {
      if (err) {
        return res
          .status(400)
          .json({ message: "Error uploading file", error: err });
      }

      // File uploaded successfully to Cloudinary
      res.status(200).json({
        message: "File uploaded successfully",
        result: {
          link: result.secure_url,
        },
      });
    }
  );
};
