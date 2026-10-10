import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecipientRows } from "./recipients";
import { Person } from "./types";

const person = (over: Partial<Person>): Person => ({
  userId: 1,
  visitorId: null,
  firstName: "Kofi",
  lastName: "Owusu",
  title: null,
  email: "kofi@example.com",
  phone: "0241234567",
  countryCode: "+233",
  dateOfBirth: null,
  ...over,
});

const base = {
  dispatchId: 9,
  body: "Hi {first_name}",
  subject: "Hello {first_name}",
  defaultTitle: "Message",
  channels: { sms: true, email: true, inApp: true },
  settings: { appStoreUrl: null, playStoreUrl: null },
  ageYear: null,
};

test("one row per person per enabled channel, rendered", () => {
  const rows = buildRecipientRows({ ...base, people: [person({})] });
  assert.equal(rows.length, 3);
  const sms = rows.find((r) => r.channel === "SMS")!;
  assert.equal(sms.rendered_body, "Hi Kofi");
  assert.equal(sms.rendered_subject, "Hello Kofi");
  assert.equal(sms.address, "0241234567");
  assert.equal(sms.recipient_key, "u:1");
  assert.equal(sms.status, "PENDING");
});

test("dedupes the same person", () => {
  const rows = buildRecipientRows({ ...base, people: [person({}), person({})] });
  assert.equal(rows.length, 3);
});

test("skips with reasons: no phone, no email, visitor in-app", () => {
  const rows = buildRecipientRows({
    ...base,
    people: [person({ userId: null, visitorId: 5, phone: null, email: null })],
  });
  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
  assert.equal(byChannel.SMS.status, "SKIPPED");
  assert.equal(byChannel.SMS.error, "No phone number");
  assert.equal(byChannel.EMAIL.error, "No email address");
  assert.equal(byChannel.IN_APP.error, "Visitors have no app account");
  assert.equal(byChannel.IN_APP.recipient_key, "v:5");
});

test("disabled channels produce no rows; subject falls back to default title", () => {
  const rows = buildRecipientRows({
    ...base,
    subject: null,
    channels: { sms: false, email: false, inApp: true },
    people: [person({})],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rendered_subject, "Message");
});

test("SMS body is capped at 612 chars with an ellipsis", () => {
  const rows = buildRecipientRows({
    ...base,
    body: "x".repeat(700),
    channels: { sms: true, email: false, inApp: false },
    people: [person({})],
  });
  assert.equal(rows[0].rendered_body.length, 612);
  assert.ok(rows[0].rendered_body.endsWith("…"));
});

test("recipient_name, address and rendered_subject fit VARCHAR(191)", () => {
  const rows = buildRecipientRows({
    ...base,
    subject: "{full_name}",
    channels: { sms: false, email: true, inApp: false },
    people: [person({ firstName: "A".repeat(300), email: `${"e".repeat(300)}@x.com` })],
  });
  assert.equal(rows.length, 1);
  assert.ok(rows[0].recipient_name.length <= 191);
  assert.ok(rows[0].rendered_subject.length <= 191);
  assert.ok(rows[0].rendered_subject.length > 100);
  assert.equal(rows[0].status, "SKIPPED");
  assert.equal(rows[0].error, "Address too long");
  assert.equal(rows[0].address, null);
  assert.equal(rows[0].rendered_subject.length, 191);
  assert.ok(rows[0].rendered_subject.endsWith("…"));
});

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

test("SMS body of exactly 612 chars is not truncated; 613 is", () => {
  const run = (n: number) =>
    buildRecipientRows({
      ...base,
      body: "x".repeat(n),
      channels: { sms: true, email: false, inApp: false },
      people: [person({})],
    })[0].rendered_body;
  assert.equal(run(612), "x".repeat(612));
  const out = run(613);
  assert.equal(out.length, 612);
  assert.ok(out.endsWith("…"));
});

test("SMS cap does not leave a lone surrogate", () => {
  const rows = buildRecipientRows({
    ...base,
    body: "x".repeat(610) + "🎉🎉",
    channels: { sms: true, email: false, inApp: false },
    people: [person({})],
  });
  const b = rows[0].rendered_body;
  assert.ok(b.length <= 612);
  assert.ok(b.endsWith("…"));
  assert.ok(!LONE.test(b));
});

test("name cap does not leave a lone surrogate", () => {
  const rows = buildRecipientRows({
    ...base,
    channels: { sms: false, email: false, inApp: true },
    people: [person({ firstName: "a".repeat(190 - 1) + "🎉" + "b".repeat(100) })],
  });
  const n = rows[0].recipient_name;
  assert.ok(n.length <= 191);
  assert.ok(n.endsWith("…"));
  assert.ok(!LONE.test(n));
});

test("whitespace-only first name is trimmed away", () => {
  const rows = buildRecipientRows({
    ...base,
    channels: { sms: false, email: false, inApp: true },
    people: [person({ firstName: "   ", lastName: "Owusu" })],
  });
  assert.equal(rows[0].recipient_name, "Owusu");
});
