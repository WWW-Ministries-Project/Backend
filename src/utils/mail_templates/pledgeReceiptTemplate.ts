import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "./unifiedEmailTemplate";

export type PledgeReceiptDetails = {
  payer_name: string;
  pledge_title: string;
  /** Minor units (pesewas). The redemption itself - what the pledge receives. */
  amount_minor_units: number;
  /** Minor units. The Paystack fee the payer covered on top of the redemption. */
  fee_minor_units?: number;
  currency: string;
  reference: string;
  channel?: string | null;
  paid_at?: Date | null;
  /** Major units. What is still outstanding on this pledge after this payment. */
  outstanding?: number | null;
};

const formatAmount = (minorUnits: number, currency: string): string =>
  `${currency} ${(minorUnits / 100).toFixed(2)}`;

const formatChannel = (channel?: string | null): string | null => {
  if (!channel) return null;
  return channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Rendered in Accra time regardless of where the server runs, matching the
 * giving receipt - a bare toLocaleString() would use the server's zone.
 */
const formatReceiptDate = (paidAt?: Date | null): string =>
  (paidAt ?? new Date()).toLocaleString("en-GH", {
    timeZone: "Africa/Accra",
    dateStyle: "long",
    timeStyle: "short",
  });

export const pledgeReceiptTemplate = (details: PledgeReceiptDetails): string => {
  const channel = formatChannel(details.channel);
  const fee = details.fee_minor_units ?? 0;

  const rows: Array<[string, string]> = [
    ["Pledge", details.pledge_title],
    ["Amount redeemed", formatAmount(details.amount_minor_units, details.currency)],
    // Only itemised when a fee was actually covered - "GHS 0.00" would puzzle.
    ...(fee > 0
      ? ([
          ["Transaction fee", formatAmount(fee, details.currency)],
          [
            "Total charged",
            formatAmount(details.amount_minor_units + fee, details.currency),
          ],
        ] as Array<[string, string]>)
      : []),
    ...(details.outstanding !== null && details.outstanding !== undefined
      ? ([
          [
            "Outstanding balance",
            `${details.currency} ${details.outstanding.toFixed(2)}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ["Reference", details.reference],
    ...(channel ? [["Payment method", channel] as [string, string]] : []),
    ["Date", formatReceiptDate(details.paid_at)],
  ];

  const messageHtml = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;">${escapeEmailHtml(label)}</td>
          <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:#111827;">${escapeEmailHtml(value)}</td>
        </tr>`,
        )
        .join("")}
    </table>
  `;

  return buildUnifiedEmailTemplate({
    headerTitle: "Pledge redemption receipt",
    headerText: "Thank you for redeeming your pledge.",
    preheader: `Receipt for ${details.pledge_title}`,
    greeting: `Hello ${details.payer_name},`,
    message: "We have received your payment. The details are below.",
    messageHtml,
  });
};
