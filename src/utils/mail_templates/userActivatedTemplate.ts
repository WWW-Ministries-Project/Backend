import { buildUnifiedEmailTemplate } from "./unifiedEmailTemplate";

type UserActivatedTemplateDetails = {
  user_name: string;
  link: string;
};

export const userActivatedTemplate = (mailDetails: UserActivatedTemplateDetails) =>
  buildUnifiedEmailTemplate({
    preheader: "Your account has been activated.",
    headerTitle: "Welcome to WWM Ministry",
    headerText: "Your account is now active and ready.",
    greeting: `Hi ${mailDetails.user_name},`,
    message:
      "Your account has been successfully activated, and you're all set to get started.\n\nPlease reset your password from the default password to something secure and personal.",
    actionLabel: "Reset Password",
    actionUrl: mailDetails.link,
    secondaryText:
      "If you have any questions or need help, please contact support.",
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Contact support",
  });
