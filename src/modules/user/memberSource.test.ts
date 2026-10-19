import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberSource, summarizeVisitorVisits } from "./memberSource";

const d = (iso: string) => new Date(iso);

test("no source -> null", () => {
  assert.equal(buildMemberSource(null, null), null);
  assert.equal(buildMemberSource(undefined, undefined), null);
});

test("visitor source summarises visit rows", () => {
  const source = buildMemberSource(
    {
      id: 7,
      visitDate: d("2026-02-01T00:00:00Z"),
      visits: [
        { date: d("2026-03-01T00:00:00Z") },
        { date: d("2026-02-01T00:00:00Z") },
        { date: d("2026-04-05T00:00:00Z") },
      ],
    },
    null,
  );
  assert.deepEqual(source, {
    type: "VISITOR",
    visitor: {
      id: 7,
      first_visit_at: d("2026-02-01T00:00:00Z"),
      last_visit_at: d("2026-04-05T00:00:00Z"),
      visit_count: 3,
    },
  });
});

test("visitor without visit rows counts the registration visit once", () => {
  assert.deepEqual(
    summarizeVisitorVisits({ id: 1, visitDate: d("2026-01-10T00:00:00Z"), visits: [] }),
    {
      first_visit_at: d("2026-01-10T00:00:00Z"),
      last_visit_at: d("2026-01-10T00:00:00Z"),
      visit_count: 1,
    },
  );
  assert.deepEqual(summarizeVisitorVisits({ id: 1, visitDate: null, visits: [] }), {
    first_visit_at: null,
    last_visit_at: null,
    visit_count: 0,
  });
});

test("registration visitDate earlier than visit rows bounds first_visit_at", () => {
  const summary = summarizeVisitorVisits({
    id: 1,
    visitDate: d("2025-12-01T00:00:00Z"),
    visits: [{ date: d("2026-01-01T00:00:00Z") }],
  });
  assert.deepEqual(summary.first_visit_at, d("2025-12-01T00:00:00Z"));
  assert.equal(summary.visit_count, 1);
});

test("soul-won source", () => {
  assert.deepEqual(
    buildMemberSource(null, {
      id: 3,
      date_won: d("2026-05-01T00:00:00Z"),
      lifeCenter: { name: "East" },
      wonBy: { name: "Ama Mensah" },
    }),
    {
      type: "SOUL_WON",
      soul_won: {
        id: 3,
        date_won: d("2026-05-01T00:00:00Z"),
        life_center_name: "East",
        won_by_name: "Ama Mensah",
      },
    },
  );
  assert.deepEqual(buildMemberSource(null, { id: 4, date_won: null }), {
    type: "SOUL_WON",
    soul_won: { id: 4, date_won: null, life_center_name: null, won_by_name: null },
  });
});

test("visitor wins when both links exist", () => {
  const source = buildMemberSource(
    { id: 1, visitDate: d("2026-01-01T00:00:00Z"), visits: [] },
    { id: 2, date_won: d("2026-01-01T00:00:00Z") },
  );
  assert.equal(source?.type, "VISITOR");
});
