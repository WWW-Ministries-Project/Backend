import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyVideo, parseIsoDurationSeconds } from "./videoClassification";

test("parseIsoDurationSeconds parses hours/minutes/seconds", () => {
  assert.equal(parseIsoDurationSeconds("PT1H2M3S"), 3723);
  assert.equal(parseIsoDurationSeconds("PT45S"), 45);
  assert.equal(parseIsoDurationSeconds("P0D"), 0);
  assert.equal(parseIsoDurationSeconds(undefined), 0);
});
test("classifyVideo flags a live/premiere resource", () => {
  assert.equal(classifyVideo({ contentDetails: { duration: "PT30M" }, liveStreamingDetails: { actualStartTime: "x" } }), "live");
});
test("classifyVideo flags a <=60s clip as a short", () => {
  assert.equal(classifyVideo({ contentDetails: { duration: "PT59S" } }), "short");
});
test("classifyVideo accepts a normal upload as a video", () => {
  assert.equal(classifyVideo({ contentDetails: { duration: "PT32M10S" } }), "video");
});
