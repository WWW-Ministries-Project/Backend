import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "./unifiedEmailTemplate";

export const applicationLiveTemplate = (
  loginLink: string,
  guestLink: string,
  itContact: string,
  name: string,
  email: string,
) => {
  const safeLoginLink = String(loginLink || "").trim();
  const safeGuestLink = String(guestLink || "").trim();
  const safeContact = String(itContact || "").trim();
  const safeName = String(name || "Member").trim();
  const safeEmail = String(email || "").trim();
  const supportUrl = safeContact.includes("@")
    ? `mailto:${safeContact}`
    : safeLoginLink || String(process.env.Frontend_URL || "").trim();

  const messageHtml = `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        Kindly note that there are two different links, one for <strong>Registered WWM Members</strong> and one for <strong>Non-Registered WWM Members</strong>. Please follow the right guide depending on your status.
                      </p>
                      <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #080d2d;">For Registered WWM Members</p>
                      <ol style="margin: 0 0 18px 18px; padding: 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                        <li>Use this link: <a href="${escapeEmailHtml(safeLoginLink)}" target="_blank" rel="noopener noreferrer" style="color: #9c622a; text-decoration: underline;">${escapeEmailHtml(safeLoginLink)}</a></li>
                        <li>Log in with email <strong>${escapeEmailHtml(safeEmail)}</strong> and password <strong>123456</strong>.</li>
                        <li>Click the three dots beside the WWM logo and select <strong>Marketplace</strong>.</li>
                        <li>Select your apparel, add items to cart, and proceed to payment.</li>
                      </ol>
                      <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #080d2d;">For Non-Registered WWM Members</p>
                      <ol style="margin: 0 0 18px 18px; padding: 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                        <li>Use this link: <a href="${escapeEmailHtml(safeGuestLink)}" target="_blank" rel="noopener noreferrer" style="color: #9c622a; text-decoration: underline;">${escapeEmailHtml(safeGuestLink)}</a></li>
                        <li>No login is required. Browse available apparels and place your order.</li>
                      </ol>
                      <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Important:</strong> Orders are confirmed only after payment on the platform. No cash payments are accepted.
                      </p>
                      <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                        During payment, an OTP will be sent via SMS to the MOMO number used. For assistance, contact the Registry Head or IT Department at ${escapeEmailHtml(safeContact)}.
                      </p>`;

  return buildUnifiedEmailTemplate({
    preheader: "PA25 apparel ordering links and instructions.",
    headerTitle: "PA25 Apparel Ordering Guide",
    headerText:
      "Order instructions for registered and non-registered members.",
    greeting: `Dear ${safeName},`,
    messageHtml,
    actionLabel: "Open Registered Member Link",
    actionUrl: safeLoginLink,
    secondaryText:
      "If the main button does not work, use the link shown below or the guest link in the instructions.",
    supportUrl,
    supportLabel: "Contact IT Department",
  });
};
