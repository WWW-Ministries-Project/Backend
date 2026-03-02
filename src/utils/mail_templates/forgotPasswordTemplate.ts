import { buildUnifiedEmailTemplate } from "./unifiedEmailTemplate";

type ForgetPasswordTemplateDetails = {
  user_name: string;
  link: string;
  expiration: string;
};

export const forgetPasswordTemplate = (
  mailDetails: ForgetPasswordTemplateDetails,
) =>
  buildUnifiedEmailTemplate({
    preheader: "Reset your password securely.",
    headerTitle: "Password Reset",
    headerText: "A password reset request was received for your account.",
    greeting: `Hi ${mailDetails.user_name},`,
    message:
      "We received a request to reset the password for your account. If you made this request, click the button below to set a new password.",
    actionLabel: "Reset Password",
    actionUrl: mailDetails.link,
    secondaryText: `If you didn't request a password reset, you can safely ignore this email. This link will expire in ${mailDetails.expiration}.`,
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Contact support",
  });
