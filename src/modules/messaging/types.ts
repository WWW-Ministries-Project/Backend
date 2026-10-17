/**
 * Types shared across the messaging module. No runtime code beyond constants.
 */

export const TEMPLATE_KEYS = [
  "WELCOME_MEMBER",
  "WELCOME_GUEST",
  "WELCOME_VISITOR",
  "BIRTHDAY",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type Channels = { sms: boolean; email: boolean; inApp: boolean };

/** Which placeholders a message may use. */
export type PlaceholderKind = "WELCOME" | "BIRTHDAY" | "GENERAL";

export const placeholderKindOf = (key: TemplateKey): PlaceholderKind =>
  key === "BIRTHDAY" ? "BIRTHDAY" : "WELCOME";

/** Someone a message can be rendered for and delivered to. */
export type Person = {
  userId: number | null;
  visitorId: number | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  countryCode: string | null;
  dateOfBirth: Date | null;
};

export type Audience = {
  scope: "CHURCH" | "DEPARTMENTS" | "PEOPLE";
  departmentIds: number[];
  userIds: number[];
  includeGuests: boolean;
  includeVisitors: boolean;
};

export const toChannels = (value: unknown): Channels => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    sms: record.sms === true,
    email: record.email === true,
    inApp: record.inApp === true,
  };
};

export const hasAnyChannel = (channels: Channels): boolean =>
  channels.sms || channels.email || channels.inApp;
