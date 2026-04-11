import { uploadDataUrlToS3 } from "./s3";

const upload: any = async (file: any) => {
  try {
    const data = await uploadDataUrlToS3(String(file || ""), {
      folder: "www-ministires/events_qr",
      baseName: "event-qr",
      originalName: "event-qr.png",
    });
    return data.url;
  } catch (error) {
    return "Unable to upload";
  }
};

export default upload;
