import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "./unifiedEmailTemplate";

type AppointmentStatusMailDetails = {
  requesterName: string;
  attendeeName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "CONFIRMED" | "PENDING";
};

export const appointmentStatusTemplate = (
  details: AppointmentStatusMailDetails,
) => {
  const statusLabel =
    details.status === "CONFIRMED" ? "confirmed" : "unconfirmed";

  const statusColor = details.status === "CONFIRMED" ? "#0f766e" : "#b45309";

  const messageHtml = `<p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        Your appointment request has been <strong style="color:${statusColor}; text-transform: uppercase;">${escapeEmailHtml(statusLabel)}</strong>.
                      </p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 16px 0 22px 0; border: 1px solid #e5e7eb; border-radius: 8px;">
                        <tr>
                          <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #4b5563;">
                            <strong style="color: #080d2d;">Attendee:</strong> ${escapeEmailHtml(details.attendeeName)}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #4b5563;">
                            <strong style="color: #080d2d;">Date:</strong> ${escapeEmailHtml(details.date)}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 14px; font-size: 14px; color: #4b5563;">
                            <strong style="color: #080d2d;">Time:</strong> ${escapeEmailHtml(details.startTime)} - ${escapeEmailHtml(details.endTime)}
                          </td>
                        </tr>
                      </table>`;

  return buildUnifiedEmailTemplate({
    preheader: `Appointment ${statusLabel}`,
    headerTitle: "Appointment Status Update",
    headerText: "Your appointment request has been updated.",
    greeting: `Hello ${details.requesterName},`,
    messageHtml,
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Contact the church office",
    showActionUrl: false,
  });
};
