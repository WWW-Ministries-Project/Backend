import test from "node:test";
import assert from "node:assert/strict";
import { computeCell, rubricPercentage, summarizeLearner, type Cell } from "./gradebookMath";

const NOW = new Date("2026-10-17T12:00:00Z");
const PAST = new Date("2026-10-10T23:59:00Z");
const FUTURE = new Date("2026-10-24T23:59:00Z");
const base = { unitPassMark: 50, dueDate: null, progress: null, latestSubmission: null, override: null };

test("computeCell: excused override wins and is not counted", () => {
  const c = computeCell({ ...base, override: { score: 90, excused: true } }, NOW);
  assert.equal(c.status, "excused");
  assert.equal(c.counted, null);
});

test("computeCell: score override counts", () => {
  const c = computeCell({ ...base, dueDate: PAST, override: { score: 0, excused: false } }, NOW);
  assert.deepEqual([c.status, c.score, c.counted, c.passed], ["overridden", 0, 0, false]);
});

test("computeCell: pending submission needs grading even if an older attempt was graded", () => {
  const c = computeCell(
    {
      ...base,
      progress: { score: 40, status: "FAIL", completed: true },
      latestSubmission: { id: 7, status: "RESUBMITTED", attempt: 2 },
    },
    NOW,
  );
  assert.deepEqual([c.status, c.submissionId, c.counted], ["needs_grading", 7, null]);
});

test("computeCell: graded progress", () => {
  const c = computeCell({ ...base, progress: { score: 80, status: "PASS", completed: true } }, NOW);
  assert.deepEqual([c.status, c.score, c.passed, c.counted], ["graded", 80, true, 80]);
});

test("computeCell: past due with nothing is missing and counts as 0", () => {
  const c = computeCell({ ...base, dueDate: PAST }, NOW);
  assert.deepEqual([c.status, c.counted], ["missing", 0]);
});

test("computeCell: not yet due is open", () => {
  assert.equal(computeCell({ ...base, dueDate: FUTURE }, NOW).status, "open");
  assert.equal(computeCell(base, NOW).status, "open");
});

const cell = (status: Cell["status"], counted: number | null, passed: boolean | null = null): Cell => ({
  status,
  score: counted,
  passed,
  submissionId: null,
  counted,
});

test("summarizeLearner: weighted grade renormalises over categories with data", () => {
  const s = summarizeLearner({
    mode: "WEIGHTED",
    passMark: 50,
    weights: { quiz: 30, essay: 40, exam: 20, attendance: 10 },
    minAttendance: null,
    cells: [
      { category: "quiz", cell: cell("graded", 80, true) },
      { category: "quiz", cell: cell("graded", 60, true) },
      { category: "essay", cell: cell("graded", 90, true) },
      { category: "exam", cell: cell("open", null) },
    ],
    attendance: null,
    completed: false,
  });
  // (30*70 + 40*90) / 70 = 81.43
  assert.equal(s.finalGrade, 81);
  assert.equal(s.status, "On track");
});

test("summarizeLearner: at risk on two missing or attendance below 75", () => {
  const s = summarizeLearner({
    mode: "PASS_FAIL",
    passMark: 50,
    weights: { quiz: 25, essay: 25, exam: 25, attendance: 25 },
    minAttendance: null,
    cells: [
      { category: "quiz", cell: cell("missing", 0, false) },
      { category: "essay", cell: cell("missing", 0, false) },
    ],
    attendance: 60,
    completed: false,
  });
  assert.equal(s.finalGrade, null);
  assert.equal(s.status, "At risk");
  assert.deepEqual(s.reasons, ["2 missing", "Attendance 60%"]);
});

test("summarizeLearner: completed enrollment reports Completed", () => {
  const s = summarizeLearner({
    mode: "WEIGHTED",
    passMark: 90,
    weights: { quiz: 100, essay: 0, exam: 0, attendance: 0 },
    minAttendance: null,
    cells: [{ category: "quiz", cell: cell("graded", 50, true) }],
    attendance: null,
    completed: true,
  });
  assert.equal(s.status, "Completed");
});

test("rubricPercentage weights criteria by level factor", () => {
  const criteria = [
    { id: "a", label: "Grounding", weight: 40 },
    { id: "b", label: "Application", weight: 60 },
  ];
  const levels = [
    { id: "x", label: "Excellent", factor: 1 },
    { id: "g", label: "Good", factor: 0.8 },
  ];
  assert.equal(rubricPercentage(criteria, levels, { a: "x", b: "g" }), 88);
  assert.throws(() => rubricPercentage(criteria, levels, { a: "x" }), /Application/);
});
