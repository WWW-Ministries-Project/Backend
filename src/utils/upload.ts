import cloudinary from "./cloudinary";

const upload = (file: any) => {
  const data = cloudinary.uploader.upload(
    file,
    { folder: "www-ministires", quality: "auto" },
    (err: any, result: any) => {
      if (err) {
        return "Error uploading file";
      }

      // File uploaded successfully to Cloudinary
      return {
        message: "File uploaded successfully",
        result: {
          link: result.secure_url,
        },
      };
    }
  );
  return data;
};

export default upload;
