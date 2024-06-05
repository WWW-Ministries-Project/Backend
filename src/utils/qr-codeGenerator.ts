import QRCode from "qrcode";
import upload from "./upload";

export const generateQR = async (text: any) => {
  try {
    let d1 = await QRCode.toDataURL(text);
    return await upload(d1);
  } catch (err) {
    console.error(err);
  }
};
