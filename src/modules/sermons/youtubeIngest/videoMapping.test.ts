import { test } from "node:test";
import assert from "node:assert/strict";
import { mapVideoToSermonFields } from "./videoMapping";
test("mapVideoToSermonFields takes title/description/tags verbatim", () => {
  const f = mapVideoToSermonFields({ id: "abc123", snippet: { title: "  Sunday Service  ", description: "Full sermon text\nwith lines", tags: ["Faith", "Grace"], publishedAt: "2026-10-20T10:00:00Z" } });
  assert.equal(f.video_id, "abc123");
  assert.equal(f.title, "Sunday Service");
  assert.equal(f.description, "Full sermon text\nwith lines");
  assert.deepEqual(f.tags, ["Faith", "Grace"]);
  assert.equal(f.youtube_url, "https://www.youtube.com/watch?v=abc123");
  assert.equal(f.thumbnail_url, "https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  assert.equal(f.preached_at, "2026-10-20T10:00:00Z");
});
test("mapVideoToSermonFields falls back to a title and empty tags", () => {
  const f = mapVideoToSermonFields({ id: "x", snippet: {} });
  assert.equal(f.title, "Sermon");
  assert.deepEqual(f.tags, []);
  assert.equal(f.description, undefined);
});
