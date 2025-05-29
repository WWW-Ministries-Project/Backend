import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
dotenv.config();

export const sendEmail = (template: string, to: string, subject: string) => {
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    // service: "gmail",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASSWORD,
    },

    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: `World Wide Word Ministries <${process.env.MAIL_FROM}>`,
    to,
    subject,
    html: template,
  };

  transporter.sendMail(mailOptions, (error) => {
    if (error) {
      return error;
    } else {
      return "Email sent";
    }
  });
};
