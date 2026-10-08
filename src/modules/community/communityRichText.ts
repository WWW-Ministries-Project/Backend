/**
 * Rich-text bodies for Community posts and comments. Clients send HTML
 * wrapped in <html>…</html> (the mobile rich-text editor's output); rows
 * written before that are plain text. Everything here takes either and never
 * throws. Pure: no Prisma, no I/O.
 *
 * The sanitizer does not pass markup through: it tokenizes the input and
 * re-emits only whitelisted tags and attributes, re-escaping every text run
 * and attribute value, so nothing the client sent reaches the output as raw
 * markup.
 */

const ALLOWED_TAGS = new Set([
  "html",
  "p",
  "br",
  "b",
  "i",
  "u",
  "s",
  "code",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "codeblock",
  "mention",
]);

const VOID_TAGS = new Set(["br"]);

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "textarea",
  "noscript",
  "template",
  "title",
  "head",
  "xmp",
  "noembed",
  "noframes",
  "svg",
  "math",
]);

/** Block elements: each starts on its own line in the plain-text rendering. */
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "codeblock"]);

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const MAX_MENTION_ATTR_LENGTH = 200;
/** user.id is a 32-bit INT; anything larger can't be a member. */
const MAX_USER_ID = 2147483647;

/**
 * Attributes inside a tag. Bounded (count and quoted-value length) so a
 * malformed tag that never closes can't make matching quadratic.
 */
const TAG_ATTRIBUTES = `((?:(?:\\s+|(?<=["']))[^\\s"'>\\/=]+(?:\\s*=\\s*(?:"[^"]{0,2048}"|'[^']{0,2048}'|[^\\s"'=<>\`]{1,2048}))?){0,32})`;
const TOKEN = new RegExp(
  `<!--[\\s\\S]*?(?:-->|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)|<[!?][^>]*>?|<(\\/?)([a-zA-Z][a-zA-Z0-9-]*)${TAG_ATTRIBUTES}\\s*\\/?>`,
  "g",
);
const MENTION_TAG = new RegExp(`<mention${TAG_ATTRIBUTES}\\s*\\/?>`, "gi");
const ATTRIBUTE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });

const escapeText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttribute = (text: string): string => escapeText(text).replace(/"/g, "&quot;");

/** Attribute names lower-cased, values entity-decoded. */
const parseAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (name in attributes) continue;
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
};

/** True when the body is rich text rather than a legacy plain-text body. */
export const isHtmlBody = (body: string): boolean => /^<html[\s>]/i.test(body.trimStart());

type Mention = { id: number | null; text: string; indicator: string };

const toMention = (attributes: Record<string, string>): Mention => {
  const raw = attributes.id?.trim() ?? "";
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return {
    id: Number.isInteger(id) && id > 0 && id <= MAX_USER_ID ? id : null,
    text: (attributes.text ?? "").slice(0, MAX_MENTION_ATTR_LENGTH),
    indicator: (attributes.indicator ?? "@").slice(0, 8),
  };
};

/** The inner text, unless it is empty or lacks the indicator; then indicator + text attribute. */
const mentionDisplay = (mention: Mention, inner: string): string => {
  const text = inner.replace(/\s+/g, " ").trim();
  return text && text.includes(mention.indicator) ? text : `${mention.indicator}${mention.text}`;
};

/** The whitelisted attributes of an allowed tag, serialized; null to unwrap the tag. */
const safeAttributes = (tag: string, attributes: Record<string, string>): string | null => {
  switch (tag) {
    case "a": {
      const href = (attributes.href ?? "").replace(/[\u0000- \u007f]/g, "");
      return SAFE_HREF.test(href) ? ` href="${escapeAttribute(href)}"` : null;
    }
    case "ul":
      return attributes["data-type"]?.trim().toLowerCase() === "checkbox" ? ' data-type="checkbox"' : "";
    case "li":
      return "checked" in attributes
        ? ` checked="${escapeAttribute(attributes.checked.trim().slice(0, 8) || "true")}"`
        : "";
    default:
      return "";
  }
};

/** Index just past the closing tag of `tag` at or after `from`, or the end of the input. */
const skipPast = (html: string, tag: string, from: number): { contentEnd: number; next: number } => {
  const close = new RegExp(`</${tag}\\s*>`, "ig");
  close.lastIndex = from;
  const match = close.exec(html);
  return match ? { contentEnd: match.index, next: match.index + match[0].length } : { contentEnd: html.length, next: html.length };
};

/** Inner text of a markup fragment: tags dropped, entities decoded. */
const fragmentText = (fragment: string): string => decodeEntities(fragment.replace(/<[^>]*>?/g, ""));

/**
 * Re-emits an HTML body keeping only the allowed tags and attributes. Tags
 * are balanced (unmatched closers dropped, open tags closed at the end); a
 * mention without a numeric id, or a link without an http(s)/mailto href, is
 * unwrapped to its text. Plain-text bodies are returned unchanged.
 */
export const sanitizeBody = (body: string): string => {
  if (!isHtmlBody(body)) return body;
  const html = body.trim();
  let out = "";
  const open: string[] = [];
  let cursor = 0;
  TOKEN.lastIndex = 0;

  while (cursor < html.length) {
    TOKEN.lastIndex = cursor;
    const match = TOKEN.exec(html);
    if (!match) {
      out += escapeText(decodeEntities(html.slice(cursor)));
      break;
    }
    out += escapeText(decodeEntities(html.slice(cursor, match.index)));
    cursor = match.index + match[0].length;
    if (!match[2]) continue; // comment, CDATA, doctype or processing instruction

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing) cursor = skipPast(html, tag, cursor).next;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;

    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }

    const attributes = parseAttributes(match[3] ?? "");

    if (tag === "mention") {
      // A mention is flattened to its text and either kept with its three
      // attributes or, without a usable id, unwrapped to plain text.
      const { contentEnd, next } = skipPast(html, "mention", cursor);
      const mention = toMention(attributes);
      const inner = fragmentText(html.slice(cursor, contentEnd));
      cursor = next;
      if (mention.id === null) {
        out += escapeText(mentionDisplay(mention, inner));
        continue;
      }
      out +=
        `<mention text="${escapeAttribute(mention.text)}" indicator="${escapeAttribute(mention.indicator)}"` +
        ` id="${mention.id}">${escapeText(inner.trim() ? inner : mentionDisplay(mention, inner))}</mention>`;
      continue;
    }

    const safe = safeAttributes(tag, attributes);
    if (safe === null) continue;
    if (VOID_TAGS.has(tag)) {
      out += `<${tag}>`;
      continue;
    }
    out += `<${tag}${safe}>`;
    open.push(tag);
  }

  while (open.length) out += `</${open.pop()}>`;
  return out;
};

/**
 * Readable plain text for notification copy and previews: each block element
 * on its own line (an empty paragraph is a blank line), list items as "• ", mentions as their display text,
 * entities decoded. Legacy plain-text bodies are returned unchanged.
 */
export const bodyToPlainText = (body: string): string => {
  if (!isHtmlBody(body)) return body;
  const html = body.trim();
  let out = "";
  let cursor = 0;
  /** Starts a new line unless one was just started; an explicit <br> always does. */
  const breakLine = () => {
    out = out.replace(/[ \t]+$/, "");
    if (out && !out.endsWith("\n")) out += "\n";
  };

  while (cursor < html.length) {
    TOKEN.lastIndex = cursor;
    const match = TOKEN.exec(html);
    if (!match) {
      out += decodeEntities(html.slice(cursor).replace(/\s*\n\s*/g, " "));
      break;
    }
    out += decodeEntities(html.slice(cursor, match.index).replace(/\s*\n\s*/g, " "));
    cursor = match.index + match[0].length;
    if (!match[2]) continue;

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing) cursor = skipPast(html, tag, cursor).next;
    } else if (tag === "mention" && !closing) {
      const { contentEnd, next } = skipPast(html, "mention", cursor);
      out += mentionDisplay(toMention(parseAttributes(match[3] ?? "")), fragmentText(html.slice(cursor, contentEnd)));
      cursor = next;
    } else if (tag === "br") {
      out += "\n";
    } else if (tag === "li" && !closing) {
      breakLine();
      out += "• ";
    } else if (BLOCK_TAGS.has(tag)) {
      breakLine();
    }
  }

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/** Distinct ids of the members mentioned in a body, in order; [] for plain text. */
export const mentionedUserIds = (body: string): number[] => {
  if (!isHtmlBody(body)) return [];
  const ids = new Set<number>();
  for (const match of body.matchAll(MENTION_TAG)) {
    const { id } = toMention(parseAttributes(match[1] ?? ""));
    if (id !== null) ids.add(id);
  }
  return Array.from(ids);
};
