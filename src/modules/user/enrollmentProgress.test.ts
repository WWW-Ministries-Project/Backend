import test from "node:test";
import assert from "node:assert/strict";
import { computeEnrollmentProgress } from "./enrollmentProgress";

test("counts completed or PASS rows for the program's topics", () => {
  assert.deepEqual(
    computeEnrollmentProgress({
      programId: 1,
      totalTopics: 3,
      enrollmentCompleted: false,
      progress: [
        { topicId: 10, completed: true, status: "FAIL", topicProgramId: 1 },
        { topicId: 11, completed: false, status: "PASS", topicProgramId: 1 },
        { topicId: 12, completed: false, status: "PENDING", topicProgramId: 1 },
        { topicId: 99, completed: true, status: "PASS", topicProgramId: 2 },
      ],
    }),
    { progress_percent: 67, completed_topics: 2, total_topics: 3 },
  );
});

test("completed enrollment reports 100", () => {
  assert.deepEqual(
    computeEnrollmentProgress({
      programId: 1,
      totalTopics: 4,
      enrollmentCompleted: true,
      progress: [{ topicId: 1, completed: true, status: "PASS", topicProgramId: 1 }],
    }),
    { progress_percent: 100, completed_topics: 1, total_topics: 4 },
  );
});

test("no topics -> 0 percent", () => {
  assert.deepEqual(
    computeEnrollmentProgress({ programId: 1, totalTopics: 0, enrollmentCompleted: null, progress: [] }),
    { progress_percent: 0, completed_topics: 0, total_topics: 0 },
  );
});

test("completed topics never exceed the total", () => {
  const result = computeEnrollmentProgress({
    programId: null,
    totalTopics: 1,
    enrollmentCompleted: false,
    progress: [
      { topicId: 1, completed: true, status: "PASS" },
      { topicId: 2, completed: true, status: "PASS" },
    ],
  });
  assert.deepEqual(result, { progress_percent: 100, completed_topics: 1, total_topics: 1 });
});
