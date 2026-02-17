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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Status Update</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#111827;color:#ffffff;padding:18px 24px;">
              <h2 style="margin:0;font-size:20px;font-weight:700;">Appointment Status Update</h2>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 14px 0;font-size:15px;">Hello ${details.requesterName},</p>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">
                Your appointment request has been <strong style="color:${statusColor};text-transform:uppercase;">${statusLabel}</strong>.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:6px;">
                <tr>
                  <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;"><strong>Attendee</strong>: ${details.attendeeName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;"><strong>Date</strong>: ${details.date}</td>
                </tr>
                <tr>
                  <td style="padding:12px 14px;font-size:14px;"><strong>Time</strong>: ${details.startTime} - ${details.endTime}</td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                If you have questions, please contact the church office.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#6b7280;">World Wide Word Ministries</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

