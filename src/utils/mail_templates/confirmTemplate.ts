import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "./unifiedEmailTemplate";

type ConfirmTemplateDetails = {
  name: string;
  email: string;
  password: string;
  frontend_url: string;
};

export const confirmTemplate = (mailDetails: ConfirmTemplateDetails) => {
  const loginUrl =
    String(mailDetails.frontend_url || "").trim() ||
    String(process.env.Frontend_URL || "").trim();

  const credentialDetailsHtml = `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        You've been invited to the WWWM system. Use the default credentials below to sign in.
                      </p>
                      <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                        <strong style="color: #080d2d;">Email:</strong> ${escapeEmailHtml(mailDetails.email)}
                      </p>
                      <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                        <strong style="color: #080d2d;">Password:</strong> ${escapeEmailHtml(mailDetails.password)}
                      </p>`;

  return buildUnifiedEmailTemplate({
    preheader: "Your account invitation and login credentials are ready.",
    headerTitle: "Email Confirmation",
    headerText: "Welcome to World Wide Word Ministries.",
    greeting: `Hello ${mailDetails.name}!`,
    messageHtml: credentialDetailsHtml,
    actionLabel: "Login Here",
    actionUrl: loginUrl,
    secondaryText:
      "For account security, change your password after your first login.",
    supportUrl: loginUrl,
    supportLabel: "Get support",
  });
};
