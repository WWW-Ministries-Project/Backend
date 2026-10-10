/**
 * Builds and inserts message_recipient rows. buildRecipientRows is pure.
 */
import { prisma } from "../../Models/context";
import { ageOn } from "./birthday";
import { renderTemplate } from "./placeholders";
import { Channels, Person } from "./types";

const SMS_MAX_LENGTH = (() => {
  const parsed = Number(process.env.HUBTEL_SMS_MAX_MESSAGE_LENGTH);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 612;
})();

export type RecipientRow = {
  dispatch_id: number;
  channel: "SMS" | "EMAIL" | "IN_APP";
  recipient_key: string;
  user_id: number | null;
  visitor_id: number | null;
  recipient_name: string;
  address: string | null;
  rendered_subject: string;
  rendered_body: string;
  status: "PENDING" | "SKIPPED";
  error: string | null;
};

const keyOf = (p: Person): string | null =>
  p.userId ? `u:${p.userId}` : p.visitorId ? `v:${p.visitorId}` : null;

const capSms = (text: string): string =>
  text.length > SMS_MAX_LENGTH ? `${text.slice(0, SMS_MAX_LENGTH - 1)}…` : text;

/** recipient_name, address and rendered_subject are VARCHAR(191) columns. */
const fit = (s: string, n = 191): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const buildRecipientRows = (args: {
  dispatchId: number;
  people: Person[];
  body: string;
  subject: string | null;
  defaultTitle: string;
  channels: Channels;
  settings: { appStoreUrl: string | null; playStoreUrl: string | null };
  /** Year to compute {age} for; null outside birthday sends. */
  ageYear: number | null;
}): RecipientRow[] => {
  const rows: RecipientRow[] = [];
  const seen = new Set<string>();

  for (const person of args.people) {
    const key = keyOf(person);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const ctx = {
      firstName: person.firstName,
      lastName: person.lastName,
      title: person.title,
      age: args.ageYear && person.dateOfBirth ? ageOn(person.dateOfBirth, args.ageYear) : null,
      appStoreUrl: args.settings.appStoreUrl,
      playStoreUrl: args.settings.playStoreUrl,
    };
    const body = renderTemplate(args.body, ctx);
    const subject = fit(renderTemplate(args.subject || args.defaultTitle, ctx));
    const name = fit([person.firstName, person.lastName].filter(Boolean).join(" ") || "Unknown");
    const common = {
      dispatch_id: args.dispatchId,
      recipient_key: key,
      user_id: person.userId,
      visitor_id: person.visitorId,
      recipient_name: name,
      rendered_subject: subject,
    };
    const row = (
      channel: RecipientRow["channel"],
      address: string | null,
      renderedBody: string,
      skipReason: string | null,
    ): RecipientRow => ({
      ...common,
      channel,
      address: address === null ? null : fit(address),
      rendered_body: renderedBody,
      status: skipReason ? "SKIPPED" : "PENDING",
      error: skipReason,
    });

    if (args.channels.sms) {
      const phone = person.phone?.trim() || null;
      rows.push(row("SMS", phone, capSms(body), phone ? null : "No phone number"));
    }
    if (args.channels.email) {
      const email = person.email?.trim() || null;
      rows.push(row("EMAIL", email, body, email ? null : "No email address"));
    }
    if (args.channels.inApp) {
      rows.push(row("IN_APP", null, body, person.userId ? null : "Visitors have no app account"));
    }
  }
  return rows;
};

/** Inserts in chunks; duplicates (same dispatch/channel/person) are ignored. */
export const insertRecipients = async (rows: RecipientRow[]): Promise<number> => {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const result = await prisma.message_recipient.createMany({
      data: rows.slice(i, i + 1000),
      skipDuplicates: true,
    });
    inserted += result.count;
  }
  return inserted;
};
