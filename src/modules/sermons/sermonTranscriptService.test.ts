import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTranscript, type TranscriptSegment } from "./sermonTranscriptService";

const segments: TranscriptSegment[] = [
  { text: "Today we talk about faith", offset: 0, duration: 3 },
  { text: "and overcoming fear in your life", offset: 3, duration: 4 },
  { text: "God gives us grace", offset: 7, duration: 2 },
];

test("phrase match returns the offset of the matching cue", () => {
  const match = matchTranscript(segments, "overcoming fear");
  assert.ok(match);
  assert.equal(match.offset, 3);
  assert.equal(match.count, 1);
  assert.match(match.snippet, /overcoming fear/);
});

test("match is case-insensitive", () => {
  const match = matchTranscript(segments, "FAITH");
  assert.ok(match);
  assert.equal(match.offset, 0);
});

test("token (AND) match across cues anchors on the earliest token", () => {
  const match = matchTranscript(segments, "grace faith");
  assert.ok(match); // both words present, different cues, any order
  assert.equal(match.offset, 0); // "faith" appears first
});

test("a missing token means no match (AND semantics)", () => {
  assert.equal(matchTranscript(segments, "faith bicycle"), null);
});

test("empty query or empty transcript yields null", () => {
  assert.equal(matchTranscript(segments, "   "), null);
  assert.equal(matchTranscript([], "faith"), null);
});

test("repeated phrase occurrences are counted", () => {
  const repeated: TranscriptSegment[] = [{ text: "grace grace grace", offset: 1, duration: 2 }];
  const match = matchTranscript(repeated, "grace");
  assert.ok(match);
  assert.equal(match.count, 3);
});

test("offset maps to the cue that holds the match", () => {
  const spread: TranscriptSegment[] = [
    { text: "welcome everyone", offset: 0, duration: 2 },
    { text: "let us pray together now", offset: 95.4, duration: 3 },
  ];
  const match = matchTranscript(spread, "pray together");
  assert.ok(match);
  assert.equal(match.offset, 95.4);
});
