import test from "node:test";
import assert from "node:assert/strict";
import { smsCountryCodeFor, isRetryableSmsError, isValidEmail, sanitizeSubject } from "./channelRules";

test("smsCountryCodeFor: international numbers get no country code", () => {
  assert.equal(smsCountryCodeFor("+372 512 3456", "+233"), null);
  assert.equal(smsCountryCodeFor(" 00447700900123", null), null);
});

test("smsCountryCodeFor: national numbers use stored code or +233", () => {
  assert.equal(smsCountryCodeFor("0241234567", "+233"), "+233");
  assert.equal(smsCountryCodeFor("0241234567", null), "+233");
  assert.equal(smsCountryCodeFor("0241234567", "+44"), "+44");
});

test("isRetryableSmsError", () => {
  assert.equal(isRetryableSmsError({ transient: true, code: "x" }), true);
  assert.equal(isRetryableSmsError({ transient: false, statusCode: 429, code: "http_429" }), true);
  assert.equal(isRetryableSmsError({ transient: false, statusCode: 408, code: "http_408" }), true);
  assert.equal(isRetryableSmsError({ transient: false, statusCode: 400, code: "http_400" }), false);
  assert.equal(isRetryableSmsError(new Error("ECONNRESET")), true);
});

test("isValidEmail", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("a b@c.com"), false);
  assert.equal(isValidEmail("nope"), false);
  assert.equal(isValidEmail("a@b"), false);
});

test("sanitizeSubject strips CR/LF", () => {
  assert.equal(sanitizeSubject("Hi\r\nBcc: x"), "Hi Bcc: x");
});
