import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { EMAIL_LOGO_CID } from "./mail_templates/unifiedEmailTemplate";
dotenv.config();

type EmailAttachment = {
  filename?: string;
  content?: string | Buffer;
  path?: string;
  cid?: string;
  contentType?: string;
};

type SendEmailOptions = {
  throwOnError?: boolean;
  attachments?: EmailAttachment[];
};

type SmtpAttempt = {
  secure: boolean;
  port: number;
  requireTLS: boolean;
  ignoreTLS: boolean;
};

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveMailPort() {
  const parsed = Number(process.env.MAIL_PORT);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function normalizeMailHost(host: string) {
  const trimmed = host.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(
      trimmed.includes("://") ? trimmed : `smtp://${trimmed}`,
    );
    return parsed.hostname;
  } catch {
    return trimmed;
  }
}

function getTransporter(host: string, attempt: SmtpAttempt) {
  return nodemailer.createTransport({
    host,
    port: attempt.port,
    secure: attempt.secure,
    requireTLS: attempt.requireTLS,
    ignoreTLS: attempt.ignoreTLS,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    // Some SMTP providers use self-signed certs in test environments.
    tls: {
      rejectUnauthorized: false,
    },
  });
}

function buildSmtpAttempts(): SmtpAttempt[] {
  const configuredSecure = parseBooleanEnv(process.env.MAIL_SECURE, false);
  const configuredPort = resolveMailPort();
  const attempts: SmtpAttempt[] = [];

  const pushAttempt = (
    secure: boolean,
    port: number,
    requireTLS = false,
    ignoreTLS = false,
  ) => {
    if (
      !attempts.some(
        (a) =>
          a.secure === secure &&
          a.port === port &&
          a.requireTLS === requireTLS &&
          a.ignoreTLS === ignoreTLS,
      )
    ) {
      attempts.push({ secure, port, requireTLS, ignoreTLS });
    }
  };

  if (configuredPort) {
    if (configuredSecure) {
      // Implicit TLS first, then STARTTLS/plaintext fallbacks.
      pushAttempt(true, configuredPort);
      pushAttempt(false, configuredPort, true, false);
      pushAttempt(false, configuredPort, false, true);
    } else {
      // STARTTLS/plaintext first, then implicit TLS fallback.
      pushAttempt(false, configuredPort, true, false);
      pushAttempt(false, configuredPort, false, true);
      pushAttempt(true, configuredPort);
    }
  }

  // Common SMTP combinations for graceful fallback.
  pushAttempt(false, 587, true, false);
  pushAttempt(false, 587, false, true);
  pushAttempt(true, 465);
  pushAttempt(false, 2525, true, false);
  pushAttempt(false, 2525, false, true);

  return attempts;
}

function isTlsHandshakeError(error: any) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("wrong version number") ||
    message.includes("ssl3_get_record") ||
    message.includes("ssl routines") ||
    message.includes("tls") ||
    message.includes("eproto")
  );
}

function isAuthenticationError(error: any) {
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    code === "EAUTH" ||
    message.includes("auth") ||
    message.includes("invalid login")
  );
}

function formatAttempt(attempt: SmtpAttempt) {
  return `secure=${attempt.secure}, port=${attempt.port}, requireTLS=${attempt.requireTLS}, ignoreTLS=${attempt.ignoreTLS}`;
}

const resolveLogoPath = (inputPath: string) =>
  path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);

const LOGO_PATH_CANDIDATES = [
  String(process.env.MAIL_LOGO_PATH || "").trim(),
  resolveLogoPath("src/assets/main-logo.png"),
  resolveLogoPath("src/assets/main-logo.svg"),
  resolveLogoPath("dist/src/assets/main-logo.png"),
  resolveLogoPath("dist/src/assets/main-logo.svg"),
].filter(Boolean);

let cachedLogoAttachment: EmailAttachment | null | undefined;

const buildInlineLogoAttachment = (): EmailAttachment | null => {
  if (cachedLogoAttachment !== undefined) {
    return cachedLogoAttachment;
  }

  for (const candidatePath of LOGO_PATH_CANDIDATES) {
    try {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      const extension = path.extname(candidatePath).toLowerCase();

      if (extension === ".png") {
        cachedLogoAttachment = {
          filename: "main-logo.png",
          path: candidatePath,
          cid: EMAIL_LOGO_CID,
          contentType: "image/png",
        };
        return cachedLogoAttachment;
      }

      const fileContent = fs.readFileSync(candidatePath, "utf8");
      const embeddedPngMatch = fileContent.match(
        /data:image\/png;base64,([^"'\s>]+)/i,
      );

      if (embeddedPngMatch?.[1]) {
        cachedLogoAttachment = {
          filename: "main-logo.png",
          content: Buffer.from(embeddedPngMatch[1], "base64"),
          cid: EMAIL_LOGO_CID,
          contentType: "image/png",
        };
        return cachedLogoAttachment;
      }

      cachedLogoAttachment = {
        filename: "main-logo.svg",
        content: fileContent,
        cid: EMAIL_LOGO_CID,
        contentType: "image/svg+xml",
      };
      return cachedLogoAttachment;
    } catch {
      continue;
    }
  }

  cachedLogoAttachment = null;
  return cachedLogoAttachment;
};

const getMailAttachments = (options: SendEmailOptions): EmailAttachment[] => {
  const attachments = [...(options.attachments || [])];
  const logoAttachment = buildInlineLogoAttachment();

  if (
    logoAttachment &&
    !attachments.some((attachment) => attachment.cid === EMAIL_LOGO_CID)
  ) {
    attachments.unshift(logoAttachment);
  }

  return attachments;
};

export const sendEmail = async (
  template: string,
  to: string,
  subject: string,
  options: SendEmailOptions = {},
) => {
  if (
    !process.env.MAIL_HOST ||
    !process.env.MAIL_USER ||
    !process.env.MAIL_PASSWORD
  ) {
    const error = new Error(
      "Missing SMTP configuration. Ensure MAIL_HOST, MAIL_USER, and MAIL_PASSWORD are set.",
    );
    if (options.throwOnError) {
      throw error;
    }
    return {
      success: false,
      error: error.message,
    };
  }

  try {
    const host = normalizeMailHost(process.env.MAIL_HOST);
    const attachments = getMailAttachments(options);
    const mailOptions = {
      from: `World Wide Word Ministries <${process.env.MAIL_FROM}>`,
      to,
      subject,
      html: template,
      attachments: attachments.length ? attachments : undefined,
    };

    let lastError: any;
    const attempts = buildSmtpAttempts();
    const attemptErrors: string[] = [];

    for (let i = 0; i < attempts.length; i += 1) {
      const attempt = attempts[i];

      try {
        const transporter = getTransporter(host, attempt);
        const info = await transporter.sendMail(mailOptions);

        return {
          success: true,
          messageId: info.messageId,
        };
      } catch (error: any) {
        lastError = error;
        attemptErrors.push(
          `${formatAttempt(attempt)} -> ${error?.message || "Unknown error"}`,
        );

        // Invalid credentials will not be fixed by retrying protocol variants.
        if (isAuthenticationError(error)) {
          break;
        }

        // Keep trying when transport or TLS negotiation appears mismatched.
        if (isTlsHandshakeError(error)) {
          continue;
        }
      }
    }

    const combinedError = new Error(
      attemptErrors.length
        ? `Failed to send email after ${attemptErrors.length} SMTP attempt(s). ${attemptErrors.join(
            " | ",
          )}`
        : lastError?.message || "Failed to send email",
    );
    throw combinedError;
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
