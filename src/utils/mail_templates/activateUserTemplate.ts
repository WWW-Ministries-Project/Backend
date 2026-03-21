import { buildUnifiedEmailTemplate } from "./unifiedEmailTemplate";

type ActivateUserTemplateDetails = {
  user_name: string;
};

const frontendUrl = String(process.env.Frontend_URL || "").trim();

export const activateUserTemplate = ({ user_name }: ActivateUserTemplateDetails) =>
  buildUnifiedEmailTemplate({
    preheader: "Your account has been activated.",
    headerTitle: "Welcome",
    headerText: "Your account is active and ready to use.",
    greeting: `Hi ${user_name},`,
    message:
      "We're excited to let you know that your account has been activated. You can now log in and start using the system.\n\nWelcome aboard!",
    actionLabel: "Log In Now",
    actionUrl: frontendUrl,
    secondaryText:
      "If the button above does not work, copy and paste the link below into your browser.",
    supportUrl: frontendUrl,
    supportLabel: "Contact support",
  });
