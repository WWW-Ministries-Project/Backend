import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseFeedEntry, verifyHubSignature, ingestNotificationDedupeKey } from "./websub";
const SAMPLE = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>VID123</yt:videoId>
    <yt:channelId>UCchannel</yt:channelId>
    <title>Hello</title>
    <published>2026-10-20T10:00:00+00:00</published>
  </entry>
</feed>`;
test("parseFeedEntry extracts videoId and channelId", () => {
  assert.deepEqual(parseFeedEntry(SAMPLE), { videoId: "VID123", channelId: "UCchannel", title: "Hello", published: "2026-10-20T10:00:00+00:00" });
});
test("parseFeedEntry returns null for a deletion/empty feed", () => {
  assert.equal(parseFeedEntry("<feed xmlns='http://www.w3.org/2005/Atom'></feed>"), null);
});
test("verifyHubSignature accepts a correct sha1 HMAC", () => {
  const body = "raw-body-bytes"; const secret = "s3cret";
  const digest = crypto.createHmac("sha1", secret).update(body).digest("hex");
  assert.equal(verifyHubSignature(body, `sha1=${digest}`, secret), true);
});
test("verifyHubSignature rejects a wrong or missing signature", () => {
  assert.equal(verifyHubSignature("body", "sha1=deadbeef", "s"), false);
  assert.equal(verifyHubSignature("body", undefined, "s"), false);
  assert.equal(verifyHubSignature("body", "sha256=abc", "s"), false);
});
test("ingestNotificationDedupeKey is stable per video+recipient", () => {
  assert.equal(ingestNotificationDedupeKey("VID123", 7), "sermon.ingested:video:VID123:recipient:7");
});
