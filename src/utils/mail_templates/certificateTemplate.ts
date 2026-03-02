import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "./unifiedEmailTemplate";

export const certificateTemplate = (
  name: string,
  certificateId: string,
  program_name: string,
) => {
  const completionDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const messageHtml = `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        This certifies that <strong>${escapeEmailHtml(name)}</strong> has successfully completed the course <strong>${escapeEmailHtml(program_name)}</strong> on ${escapeEmailHtml(completionDate)}.
                      </p>
                      <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                        <strong style="color: #080d2d;">Certificate ID:</strong> ${escapeEmailHtml(certificateId)}
                      </p>`;

  return buildUnifiedEmailTemplate({
    preheader: "Certificate of completion issued.",
    headerTitle: "Certificate of Completion",
    headerText: "Congratulations on completing your program.",
    greeting: `Dear ${name},`,
    messageHtml,
    secondaryText: "Keep your certificate ID for future reference.",
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Contact support",
    showActionUrl: false,
  });
};
