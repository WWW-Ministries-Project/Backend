import { buildUnifiedEmailTemplate } from "./unifiedEmailTemplate";

type SelfRegistrationTemplateDetails = {
  user_name: string;
  link: string;
  is_guest: boolean;
  expiration: string;
};

/**
 * Sent when someone signs up in the mobile app. Sign-up asks for no password,
 * so this carries the link to set one — without it the member could not log
 * in again once their first session ends.
 */
export const selfRegistrationTemplate = (mailDetails: SelfRegistrationTemplateDetails) =>
  buildUnifiedEmailTemplate({
    preheader: "Set a password to keep using the WWM app.",
    headerTitle: "Welcome to Worldwide Word Ministries",
    headerText: mailDetails.is_guest
      ? "You've joined as a guest."
      : "Your membership is on its way.",
    greeting: `Hi ${mailDetails.user_name},`,
    message: mailDetails.is_guest
      ? "Thanks for joining us in the WWM app. You can watch services, give and join events as a guest, and request membership any time from your Home screen.\n\nSet a password now so you can log in again on any device."
      : "Thanks for signing up in the WWM app. The church office will review and confirm your membership, and we'll let you know as soon as they do. You can keep using the app in the meantime.\n\nSet a password now so you can log in again on any device.",
    actionLabel: "Set your password",
    actionUrl: mailDetails.link,
    secondaryText: `This link expires in ${mailDetails.expiration}. If it does, use "Forgot password?" in the app to get a new one.`,
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Contact support",
  });
