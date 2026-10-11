/**
 * One function per channel. Each returns a skip reason, or throws on a
 * failure that the worker should count as an attempt.
 */
import { prisma } from "../../Models/context";
import { notificationService } from "../notifications/notificationService";
import { notificationSmsService } from "../notifications/notificationSmsService";
import { sendEmail } from "../../utils/emailService";
import { buildUnifiedEmailTemplate } from "../../utils/mail_templates/unifiedEmailTemplate";
import { InputValidationError } from "../../utils/custom-error-handlers";
import { isRetryableSmsError, isValidEmail, sanitizeSubject, smsCountryCodeFor } from "./channelRules";
import { CHURCH_NAME, renderEmailHtml } from "./placeholders";

export type ChannelRow = {
  id: number;
  dispatch_id: number;
  channel: "SMS" | "EMAIL" | "IN_APP";
  user_id: number | null;
  visitor_id: number | null;
  address: string | null;
  rendered_subject: string | null;
  rendered_body: string;
};

export class RetryableError extends Error {}
export class PermanentError extends Error {}

const countryCodeFor = async (row: ChannelRow): Promise<string | null> => {
  if (row.user_id) {
    const info = await prisma.user_info.findUnique({
      where: { user_id: row.user_id },
      select: { country_code: true },
    });
    return info?.country_code ?? null;
  }
  if (row.visitor_id) {
    const v = await prisma.visitor.findUnique({
      where: { id: row.visitor_id },
      select: { country_code: true },
    });
    return v?.country_code ?? null;
  }
  return null;
};

export const sendSmsChannel = async (row: ChannelRow): Promise<string | null> => {
  if (!row.address) return "No phone number";
  const trimmed = row.address.trim();
  const isInternational = trimmed.startsWith("+") || trimmed.startsWith("00");
  try {
    const { skipped } = await notificationSmsService.sendSmsDirect({
      phoneNumber: row.address,
      countryCode: isInternational
        ? null
        : smsCountryCodeFor(row.address, await countryCodeFor(row)),
      message: row.rendered_body,
    });
    return skipped;
  } catch (error: any) {
    const message = error?.message || "SMS failed";
    throw isRetryableSmsError(error) ? new RetryableError(message) : new PermanentError(message);
  }
};

export const sendEmailChannel = async (row: ChannelRow): Promise<string | null> => {
  if (!row.address) return "No email address";
  if (!isValidEmail(row.address.trim())) return "Invalid email address";
  const subject = sanitizeSubject(row.rendered_subject || CHURCH_NAME);
  const html = buildUnifiedEmailTemplate({
    headerTitle: subject,
    headerText: CHURCH_NAME,
    messageHtml: renderEmailHtml(row.rendered_body),
  });
  try {
    await sendEmail(html, row.address, subject, { throwOnError: true });
  } catch (error: any) {
    if (/Missing SMTP configuration/.test(error?.message || "")) {
      return "Email not configured";
    }
    throw new RetryableError(error?.message || "Email failed");
  }
  return null;
};

export const sendInAppChannel = async (row: ChannelRow): Promise<string | null> => {
  if (!row.user_id) return "Visitors have no app account";
  let result;
  try {
    result = await notificationService.createInAppNotification({
    type: "messaging.message",
    title: row.rendered_subject || CHURCH_NAME,
    body: row.rendered_body,
    recipientUserId: row.user_id,
    entityType: "message_dispatch",
    entityId: row.dispatch_id,
    dedupeKey: `messaging:${row.id}`,
    sendEmail: false,
    sendSms: false,
    });
  } catch (error: any) {
    const message = error?.message || "In-app notification failed";
    throw error instanceof InputValidationError || error?.name === "InputValidationError"
      ? new PermanentError(message)
      : new RetryableError(message);
  }
  return result ? null : "Member is inactive or turned these off";
};

export const sendByChannel = (row: ChannelRow): Promise<string | null> =>
  row.channel === "SMS"
    ? sendSmsChannel(row)
    : row.channel === "EMAIL"
      ? sendEmailChannel(row)
      : sendInAppChannel(row);
