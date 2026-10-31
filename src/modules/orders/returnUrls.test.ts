import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReturnUrls, isAllowedReturnUrl } from "./returnUrls";

test("accepts the app's own origins", () => {
  process.env.Frontend_URL = "https://web.example.org";
  assert.equal(isAllowedReturnUrl("https://web.example.org/member/verify-payment"), true);
  assert.equal(
    isAllowedReturnUrl("https://dashboard.worldwidewordministries.org/out/verify-payment/mobile"),
    true,
  );
});

test("rejects other origins and non-http schemes", () => {
  process.env.Frontend_URL = "https://web.example.org";
  assert.equal(isAllowedReturnUrl("https://evil.example.com/phish"), false);
  assert.equal(isAllowedReturnUrl("https://web.example.org.evil.com/"), false);
  assert.equal(isAllowedReturnUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedReturnUrl("not a url"), false);
  assert.throws(() => assertReturnUrls("https://evil.example.com"));
  assert.doesNotThrow(() => assertReturnUrls(null, undefined, ""));
});
