/**
 * Placeholder engine for admin messages. Pure: no Prisma, no I/O.
 *
 * Syntax is a single-brace `{token}` from a fixed whitelist. Unknown tokens
 * are rejected at save time (findUnknownPlaceholders) and left untouched by
 * renderTemplate, so a typo is visible rather than silently blank.
 */
import { escapeEmailHtml } from "../../utils/mail_templates/unifiedEmailTemplate";
import { PlaceholderKind } from "./types";

export const CHURCH_NAME = "Worldwide Word Ministries";
const NAME_FALLBACK = "Friend";

export type RenderContext = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  age: number | null;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
};

export type PlaceholderInfo = {
  token: string;
  description: string;
  kinds: PlaceholderKind[];
};

const ALL: PlaceholderKind[] = ["WELCOME", "BIRTHDAY", "GENERAL"];

export const PLACEHOLDERS: PlaceholderInfo[] = [
  { token: "{first_name}", description: "First name (\"Friend\" if unknown)", kinds: ALL },
  { token: "{last_name}", description: "Last name", kinds: ALL },
  { token: "{full_name}", description: "First and last name (\"Friend\" if unknown)", kinds: ALL },
  { token: "{title}", description: "Title, e.g. Pastor", kinds: ALL },
  { token: "{church_name}", description: CHURCH_NAME, kinds: ALL },
  { token: "{app_store_link}", description: "App Store link from Messaging settings", kinds: ALL },
  { token: "{play_store_link}", description: "Play Store link from Messaging settings", kinds: ALL },
  { token: "{app_download_link}", description: "Both store links, one per line", kinds: ALL },
  { token: "{age}", description: "Age they are turning today", kinds: ["BIRTHDAY"] },
];

export const placeholdersFor = (kind: PlaceholderKind): PlaceholderInfo[] =>
  PLACEHOLDERS.filter((p) => p.kinds.includes(kind));

const TOKEN_PATTERN = /\{[a-z_]+\}/g;

const clean = (value: string | null | undefined): string => String(value ?? "").trim();

export const appDownloadLink = (ctx: Pick<RenderContext, "appStoreUrl" | "playStoreUrl">): string =>
  [
    clean(ctx.appStoreUrl) ? `iPhone: ${clean(ctx.appStoreUrl)}` : "",
    clean(ctx.playStoreUrl) ? `Android: ${clean(ctx.playStoreUrl)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

const valueOf = (token: string, ctx: RenderContext): string | null => {
  const first = clean(ctx.firstName);
  const last = clean(ctx.lastName);
  switch (token) {
    case "{first_name}":
      return first || NAME_FALLBACK;
    case "{last_name}":
      return last;
    case "{full_name}":
      return [first, last].filter(Boolean).join(" ") || NAME_FALLBACK;
    case "{title}":
      return clean(ctx.title);
    case "{church_name}":
      return CHURCH_NAME;
    case "{app_store_link}":
      return clean(ctx.appStoreUrl);
    case "{play_store_link}":
      return clean(ctx.playStoreUrl);
    case "{app_download_link}":
      return appDownloadLink(ctx);
    case "{age}":
      return ctx.age === null ? "" : String(ctx.age);
    default:
      return null;
  }
};

export const renderTemplate = (text: string, ctx: RenderContext): string =>
  String(text ?? "")
    .replace(TOKEN_PATTERN, (token) => valueOf(token, ctx) ?? token)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const findUnknownPlaceholders = (text: string, kind: PlaceholderKind): string[] => {
  const allowed = new Set(placeholdersFor(kind).map((p) => p.token));
  const found = String(text ?? "").match(TOKEN_PATTERN) ?? [];
  return Array.from(new Set(found.filter((token) => !allowed.has(token))));
};

/** Appends {app_download_link} when the toggle is on and the body lacks it. */
export const withAppLink = (body: string, includeAppLink: boolean): string =>
  includeAppLink && !body.includes("{app_download_link}")
    ? `${body}\n{app_download_link}`
    : body;

// GSM 03.38 basic set + extension table. Anything else forces UCS-2.
const GSM_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
const GSM_SET = new Set(Array.from(GSM_CHARS));

export const smsSegments = (text: string): { length: number; segments: number; unicode: boolean } => {
  const chars = Array.from(text ?? "");
  const length = chars.length;
  if (!length) return { length: 0, segments: 0, unicode: false };
  const unicode = chars.some((c) => !GSM_SET.has(c));
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { length, segments: length <= single ? 1 : Math.ceil(length / multi), unicode };
};

const URL_PATTERN = /https?:\/\/[^\s<]+/g;

/** Plain text → safe HTML fragment for the unified email layout. */
export const renderEmailHtml = (text: string): string =>
  escapeEmailHtml(text)
    .replace(URL_PATTERN, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\n/g, "<br />");
