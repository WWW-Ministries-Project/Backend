/**
 * Pure gradebook rules for the School of Ministry LMS. Kept free of Prisma so
 * they can be unit-tested.
 */

export type Category = "quiz" | "essay" | "exam";
export type GradingMode = "PASS_FAIL" | "WEIGHTED";
export type Weights = { quiz: number; essay: number; exam: number; attendance: number };

export type CellStatus =
  | "graded"
  | "needs_grading"
  | "missing"
  | "open"
  | "excused"
  | "overridden";

export type CellInput = {
  unitPassMark: number;
  dueDate: Date | null;
  progress: { score: number | null; status: string; completed: boolean | null } | null;
  latestSubmission: { id: number; status: string; attempt: number } | null;
  override: { score: number | null; excused: boolean } | null;
};

export type Cell = {
  status: CellStatus;
  /** Percentage shown in the gradebook, or null. */
  score: number | null;
  passed: boolean | null;
  submissionId: number | null;
  /** Percentage that counts toward the final grade; null = not counted. */
  counted: number | null;
};

const PENDING_SUBMISSION = new Set(["SUBMITTED", "RESUBMITTED"]);

export const computeCell = (input: CellInput, now: Date): Cell => {
  const submissionId = input.latestSubmission?.id ?? null;

  if (input.override?.excused) {
    return { status: "excused", score: null, passed: null, submissionId, counted: null };
  }
  if (input.override && input.override.score !== null) {
    const score = input.override.score;
    return { status: "overridden", score, passed: score >= input.unitPassMark, submissionId, counted: score };
  }
  if (input.latestSubmission && PENDING_SUBMISSION.has(input.latestSubmission.status)) {
    return { status: "needs_grading", score: null, passed: null, submissionId, counted: null };
  }
  if (
    input.progress &&
    input.progress.completed &&
    input.progress.score !== null &&
    (input.progress.status === "PASS" || input.progress.status === "FAIL")
  ) {
    const score = input.progress.score;
    return { status: "graded", score, passed: input.progress.status === "PASS", submissionId, counted: score };
  }
  if (input.dueDate && input.dueDate.getTime() < now.getTime()) {
    return { status: "missing", score: null, passed: false, submissionId, counted: 0 };
  }
  return { status: "open", score: null, passed: null, submissionId, counted: null };
};

export type GradeSummary = {
  finalGrade: number | null;
  missing: number;
  needsGrading: number;
  failedUnits: number;
  status: "Completed" | "At risk" | "On track";
  reasons: string[];
};

const AT_RISK_ATTENDANCE = 75;

export const summarizeLearner = (args: {
  mode: GradingMode;
  passMark: number;
  weights: Weights;
  minAttendance: number | null;
  cells: { category: Category | null; cell: Cell }[];
  /** Attendance % for the learner, or null when no sessions have been recorded. */
  attendance: number | null;
  completed: boolean;
}): GradeSummary => {
  const missing = args.cells.filter((c) => c.cell.status === "missing").length;
  const needsGrading = args.cells.filter((c) => c.cell.status === "needs_grading").length;
  const failedUnits = args.cells.filter(
    (c) => (c.cell.status === "graded" || c.cell.status === "overridden") && c.cell.passed === false,
  ).length;

  let finalGrade: number | null = null;
  if (args.mode === "WEIGHTED") {
    let weighted = 0;
    let weightUsed = 0;
    (["quiz", "essay", "exam"] as const).forEach((cat) => {
      const counted = args.cells
        .filter((c) => c.category === cat && c.cell.counted !== null)
        .map((c) => c.cell.counted as number);
      if (counted.length && args.weights[cat] > 0) {
        weighted += args.weights[cat] * (counted.reduce((a, b) => a + b, 0) / counted.length);
        weightUsed += args.weights[cat];
      }
    });
    if (args.attendance !== null && args.weights.attendance > 0) {
      weighted += args.weights.attendance * args.attendance;
      weightUsed += args.weights.attendance;
    }
    finalGrade = weightUsed > 0 ? Math.round(weighted / weightUsed) : null;
  }

  const reasons: string[] = [];
  if (missing >= 2) reasons.push(`${missing} missing`);
  if (args.mode === "WEIGHTED" && finalGrade !== null && finalGrade < args.passMark) {
    reasons.push(`Below pass mark (${finalGrade}%)`);
  }
  if (args.mode === "PASS_FAIL" && failedUnits > 0) {
    reasons.push(`${failedUnits} unit${failedUnits === 1 ? "" : "s"} failed`);
  }
  const attendanceFloor = args.minAttendance ?? AT_RISK_ATTENDANCE;
  if (args.attendance !== null && args.attendance < attendanceFloor) {
    reasons.push(`Attendance ${Math.round(args.attendance)}%`);
  }

  return {
    finalGrade,
    missing,
    needsGrading,
    failedUnits,
    status: args.completed ? "Completed" : reasons.length ? "At risk" : "On track",
    reasons,
  };
};

export type RubricCriterion = { id: string; label: string; weight: number };
export type RubricLevel = { id: string; label: string; factor: number };

/** Weighted rubric score (0–100). Every criterion must have a known level. */
export const rubricPercentage = (
  criteria: RubricCriterion[],
  levels: RubricLevel[],
  scores: Record<string, string>,
): number => {
  const levelFactor = new Map(levels.map((l) => [l.id, l.factor]));
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) throw new Error("Rubric has no weighted criteria");
  let sum = 0;
  for (const c of criteria) {
    const factor = levelFactor.get(scores[c.id]);
    if (factor === undefined) throw new Error(`Choose a level for "${c.label}"`);
    sum += c.weight * factor;
  }
  return Math.round((sum / totalWeight) * 100);
};

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Attendance % for one learner. Only sessions where attendance was taken count
 * (a session with at least one record); a learner with no record in such a
 * session is treated as absent. Excused sessions are left out. Late counts as
 * attended. Returns null when nothing counts yet.
 */
export const attendancePercent = (
  takenSessionIds: number[],
  records: { sessionId: number; status: string }[],
): number | null => {
  const bySession = new Map(records.map((r) => [r.sessionId, r.status]));
  let attended = 0;
  let counted = 0;
  for (const id of takenSessionIds) {
    const status = bySession.get(id) ?? "ABSENT";
    if (status === "EXCUSED") continue;
    counted += 1;
    if (status === "PRESENT" || status === "LATE") attended += 1;
  }
  return counted ? Math.round((attended / counted) * 100) : null;
};
