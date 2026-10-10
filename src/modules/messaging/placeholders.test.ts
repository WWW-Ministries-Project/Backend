import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  findUnknownPlaceholders,
  appDownloadLink,
  smsSegments,
  renderEmailHtml,
  withAppLink,
} from "./placeholders";

const ctx = {
  firstName: "Ama",
  lastName: "Mensah",
  title: "Deaconess",
  age: 34,
  appStoreUrl: "https://apps.apple.com/app/id1",
  playStoreUrl: "https://play.google.com/store/apps/details?id=x",
};

test("replaces known tokens", () => {
  assert.equal(
    renderTemplate("Hi {first_name} {last_name}, {church_name}", ctx),
    "Hi Ama Mensah, Worldwide Word Ministries",
  );
});

test("missing first name falls back to Friend and tidies spacing", () => {
  assert.equal(
    renderTemplate("Hi {title} {first_name} {last_name}, welcome", {
      ...ctx,
      firstName: null,
      lastName: null,
      title: null,
    }),
    "Hi Friend, welcome",
  );
});

test("full_name falls back to Friend", () => {
  assert.equal(renderTemplate("{full_name}", { ...ctx, firstName: "", lastName: "" }), "Friend");
});

test("age renders only when known", () => {
  assert.equal(renderTemplate("Turning {age}!", ctx), "Turning 34!");
  assert.equal(renderTemplate("Turning {age}!", { ...ctx, age: null }), "Turning!");
});

test("unknown tokens are left as-is by render", () => {
  assert.equal(renderTemplate("Hi {nickname}", ctx), "Hi {nickname}");
});

test("findUnknownPlaceholders reports typos and kind-restricted tokens", () => {
  assert.deepEqual(findUnknownPlaceholders("Hi {frist_name} {first_name}", "GENERAL"), ["{frist_name}"]);
  assert.deepEqual(findUnknownPlaceholders("Turning {age}", "GENERAL"), ["{age}"]);
  assert.deepEqual(findUnknownPlaceholders("Turning {age}", "BIRTHDAY"), []);
});

test("appDownloadLink lists only configured stores", () => {
  assert.equal(
    appDownloadLink(ctx),
    "iPhone: https://apps.apple.com/app/id1\nAndroid: https://play.google.com/store/apps/details?id=x",
  );
  assert.equal(appDownloadLink({ ...ctx, appStoreUrl: null }), "Android: https://play.google.com/store/apps/details?id=x");
  assert.equal(appDownloadLink({ ...ctx, appStoreUrl: null, playStoreUrl: null }), "");
});

test("withAppLink appends the token once", () => {
  assert.equal(withAppLink("Hello", true), "Hello\n{app_download_link}");
  assert.equal(withAppLink("Get it: {app_download_link}", true), "Get it: {app_download_link}");
  assert.equal(withAppLink("Hello", false), "Hello");
});

test("collapses blank lines left by empty values", () => {
  assert.equal(
    renderTemplate("Hi\n{app_download_link}\n\n\nBye", { ...ctx, appStoreUrl: null, playStoreUrl: null }),
    "Hi\n\nBye",
  );
});

test("smsSegments: GSM vs unicode", () => {
  assert.deepEqual(smsSegments("a".repeat(160)), { length: 160, segments: 1, unicode: false });
  assert.deepEqual(smsSegments("a".repeat(161)), { length: 161, segments: 2, unicode: false });
  assert.deepEqual(smsSegments("🎉" + "a".repeat(69)), { length: 70, segments: 1, unicode: true });
  assert.deepEqual(smsSegments("🎉" + "a".repeat(70)), { length: 71, segments: 2, unicode: true });
  assert.deepEqual(smsSegments(""), { length: 0, segments: 0, unicode: false });
});

test("renderEmailHtml escapes, linkifies and keeps line breaks", () => {
  const html = renderEmailHtml("A <b>\nhttps://x.org/a?b=1&c=2");
  assert.ok(html.includes("A &lt;b&gt;<br />"));
  assert.ok(html.includes('<a href="https://x.org/a?b=1&amp;c=2">https://x.org/a?b=1&amp;c=2</a>'));
});
