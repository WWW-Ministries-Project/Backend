import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
dotenv.config();

type SendEmailOptions = {
  throwOnError?: boolean;
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: String(process.env.MAIL_SECURE).toLowerCase() === "true",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  return transporter;
}

export const sendEmail = async (
  template: string,
  to: string,
  subject: string,
  options: SendEmailOptions = {},
) => {
  try {
    const mailOptions = {
      from: `World Wide Word Ministries <${process.env.MAIL_FROM}>`,
      to,
      subject,
      html: template,
    };

    const info = await getTransporter().sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: any) {
    if (options.throwOnError) {
      throw error;
    }
    return {
      success: false,
      error: error?.message || "Failed to send email",
    };
  }
};
