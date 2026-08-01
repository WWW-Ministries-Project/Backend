import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "./unifiedEmailTemplate";

export type GivingReceiptDetails = {
  donor_name: string;
  giving_option_name: string;
  /** Minor units (pesewas) */
  amount_minor_units: number;
  currency: string;
  reference: string;
  channel?: string | null;
  paid_at?: Date | null;
};

const formatAmount = (minorUnits: number, currency: string): string =>
  `${currency} ${(minorUnits / 100).toFixed(2)}`;

const formatChannel = (channel?: string | null): string | null => {
  if (!channel) return null;
  return channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const givingReceiptTemplate = (details: GivingReceiptDetails): string => {
  const channel = formatChannel(details.channel);

  const rows: Array<[string, string]> = [
    ["Giving option", details.giving_option_name],
    ["Amount", formatAmount(details.amount_minor_units, details.currency)],
    ["Reference", details.reference],
    ...(channel ? [["Payment method", channel] as [string, string]] : []),
    ["Date", (details.paid_at ?? new Date()).toLocaleString()],
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
    headerTitle: "Giving receipt",
    headerText: "Thank you for your giving.",
    preheader: `Receipt for ${details.giving_option_name}`,
    greeting: `Hello ${details.donor_name},`,
    message: "We have received your contribution. The details are below.",
    messageHtml,
  });
};
