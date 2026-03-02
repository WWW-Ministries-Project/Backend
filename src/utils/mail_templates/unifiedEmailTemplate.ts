import fs from "fs";
import path from "path";

const DEFAULT_PRODUCT_NAME = "World Wide Word Ministries";
const DEFAULT_SUPPORT_LABEL = "Contact support";

const resolveLogoPath = (inputPath: string) =>
  path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);

const LOCAL_LOGO_PATHS = [
  String(process.env.MAIL_LOGO_PATH || "").trim(),
  resolveLogoPath("src/assets/main-logo.svg"),
  resolveLogoPath("dist/src/assets/main-logo.svg"),
].filter(Boolean);
const localLogoDataUri = (() => {
  for (const pathToLogo of LOCAL_LOGO_PATHS) {
    try {
      const logoSvg = fs.readFileSync(pathToLogo, "utf8");
      return `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
    } catch {
      continue;
    }
  }
  return "";
})();
const normalizedFrontendUrl = String(process.env.Frontend_URL || "").trim().replace(
  /\/+$/,
  "",
);
const DEFAULT_LOGO_URL =
  process.env.MAIL_LOGO_URL ||
  localLogoDataUri ||
  (normalizedFrontendUrl ? `${normalizedFrontendUrl}/logo/main-logo.svg` : "") ||
  "https://res.cloudinary.com/dt8vgj0u3/image/upload/v1747597889/main-logo_nuhmgv.svg";

const normalizeValue = (value?: string | number | null): string =>
  String(value ?? "").trim();

export const escapeEmailHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toEscapedMultilineHtml = (value: string): string =>
  escapeEmailHtml(value).replace(/\n/g, "<br />");

export type UnifiedEmailTemplateOptions = {
  preheader?: string;
  productName?: string;
  headerTitle: string;
  headerText?: string;
  greeting?: string;
  message?: string;
  messageHtml?: string;
  actionLabel?: string;
  actionUrl?: string;
  secondaryText?: string;
  supportUrl?: string;
  supportLabel?: string;
  currentYear?: number | string;
  logoUrl?: string;
  showActionUrl?: boolean;
};

export const buildUnifiedEmailTemplate = (
  options: UnifiedEmailTemplateOptions,
) => {
  const productName = normalizeValue(options.productName) || DEFAULT_PRODUCT_NAME;
  const headerTitle = normalizeValue(options.headerTitle) || productName;
  const headerText =
    normalizeValue(options.headerText) || "You have a new notification.";
  const preheader =
    normalizeValue(options.preheader) || `${headerTitle} - ${productName}`;
  const greeting = normalizeValue(options.greeting);
  const message = normalizeValue(options.message);
  const messageHtml = options.messageHtml?.trim() || "";
  const actionLabel = normalizeValue(options.actionLabel);
  const actionUrl = normalizeValue(options.actionUrl);
  const secondaryText = normalizeValue(options.secondaryText);
  const supportUrl =
    normalizeValue(options.supportUrl) || normalizeValue(process.env.Frontend_URL);
  const supportLabel = normalizeValue(options.supportLabel) || DEFAULT_SUPPORT_LABEL;
  const currentYear =
    normalizeValue(options.currentYear) || String(new Date().getFullYear());
  const logoUrl = normalizeValue(options.logoUrl) || DEFAULT_LOGO_URL;
  const shouldRenderAction = Boolean(actionLabel && actionUrl);
  const shouldRenderActionUrl = options.showActionUrl ?? Boolean(actionUrl);

  const greetingBlock = greeting
    ? `<p style="margin: 0 0 12px 0; font-size: 16px; line-height: 1.5; color: #080d2d; font-weight: 600;">
                        ${escapeEmailHtml(greeting)}
                      </p>`
    : "";

  const messageBlock = messageHtml
    ? messageHtml
    : `<p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        ${toEscapedMultilineHtml(message)}
                      </p>`;

  const actionButtonBlock = shouldRenderAction
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 18px auto">
                        <tr>
                          <td align="center" style="background-color: #b47a35; border-radius: 10px">
                            <a
                              href="${escapeEmailHtml(actionUrl)}"
                              target="_blank"
                              rel="noopener noreferrer"
                              style="
                                display: inline-block;
                                padding: 12px 24px;
                                color: #080d2d;
                                font-size: 14px;
                                font-weight: 600;
                                text-decoration: none;
                              "
                            >
                              ${escapeEmailHtml(actionLabel)}
                            </a>
                          </td>
                        </tr>
                      </table>`
    : "";

  const secondaryTextBlock = secondaryText
    ? `<p style="margin: 0 0 10px 0; font-size: 13px; line-height: 1.5; color: #6b7280">
                        ${toEscapedMultilineHtml(secondaryText)}
                      </p>`
    : "";

  const actionUrlBlock =
    shouldRenderActionUrl && actionUrl
      ? `<p style="margin: 0 0 22px 0; font-size: 13px; line-height: 1.5; word-break: break-all">
                        <a href="${escapeEmailHtml(actionUrl)}" target="_blank" rel="noopener noreferrer" style="color: #9c622a; text-decoration: underline">
                          ${escapeEmailHtml(actionUrl)}
                        </a>
                      </p>`
      : "";

  const supportBlock = supportUrl
    ? `<hr style="margin: 0 0 14px 0; border: 0; border-top: 1px solid #e0e3eb" />
                      <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #6b7280">
                        Need help?
                        <a href="${escapeEmailHtml(supportUrl)}" target="_blank" rel="noopener noreferrer" style="color: #9c622a; text-decoration: none">
                          ${escapeEmailHtml(supportLabel)}
                        </a>
                      </p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>Email Template</title>
    <style>
      @media screen and (max-width: 600px) {
        .auth-shell {
          padding: 20px 12px !important;
        }

        .auth-header,
        .auth-body {
          padding-left: 20px !important;
          padding-right: 20px !important;
        }

        .auth-title {
          font-size: 24px !important;
          line-height: 1.25 !important;
        }
      }
    </style>
  </head>
  <body
    style="
      margin: 0;
      padding: 0;
      background-color: #eef1f8;
      font-family: 'Work Sans', Arial, sans-serif;
      color: #4b5563;
    "
  >
    <div
      style="
        display: none;
        font-size: 1px;
        color: #eef1f8;
        line-height: 1px;
        max-height: 0;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
      "
    >
      ${escapeEmailHtml(preheader)}
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td class="auth-shell" align="center" style="padding: 32px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 640px">
            <tr>
              <td
                style="
                  border: 1px solid #d8dae5;
                  border-radius: 24px;
                  overflow: hidden;
                  background-color: #ffffff;
                  box-shadow: 0 20px 45px -30px rgba(8, 13, 45, 0.6);
                "
              >
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td class="auth-header" align="center" style="padding: 24px; background-color: #080d2d; color: #ffffff">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 14px auto">
                        <tr>
                          <td align="center" style="padding: 8px 12px; border-radius: 12px; background-color: #ffffff">
                            <img
                              src="${escapeEmailHtml(logoUrl)}"
                              width="67"
                              height="46"
                              alt="${escapeEmailHtml(productName)} logo"
                              style="display: block; margin: 0 auto; border: 0; outline: none; text-decoration: none"
                            />
                          </td>
                        </tr>
                      </table>
                      <h1
                        class="auth-title"
                        style="
                          margin: 0;
                          font-size: 28px;
                          font-weight: 600;
                          line-height: 1.2;
                          color: #ffffff;
                        "
                      >
                        ${escapeEmailHtml(headerTitle)}
                      </h1>
                      <p style="margin: 8px 0 0 0; font-size: 14px; line-height: 1.45; color: rgba(255, 255, 255, 0.9)">
                        ${escapeEmailHtml(headerText)}
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td class="auth-body" style="padding: 28px 32px 30px 32px">
                      ${greetingBlock}
                      ${messageBlock}
                      ${actionButtonBlock}
                      ${secondaryTextBlock}
                      ${actionUrlBlock}
                      ${supportBlock}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 14px 0 0 0; font-size: 12px; line-height: 1.4; color: #6b7280">
                &copy; ${escapeEmailHtml(currentYear)} ${escapeEmailHtml(productName)}. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
