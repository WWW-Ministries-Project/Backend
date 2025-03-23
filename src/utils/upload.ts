import cloudinary from "./cloudinary";

const upload: any = async (file: any) => {
  try {
    const data = await cloudinary.uploader.upload(
      file,
      { folder: "www-ministires/events_qr", quality: "auto" },
      (err: any, result: any) => {
        if (err) {
          return "Error uploading file";
        }
      },
    );
    return data.secure_url;
  } catch (error) {
    return "Unable to upload";
  }
};

export default upload;
