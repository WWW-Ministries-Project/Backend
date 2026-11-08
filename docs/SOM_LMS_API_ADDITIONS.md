# School of Ministry (LMS) — additive API changes

Living contract for the fields/endpoints added to feed the redesigned School of
Ministry frontend. **All changes are additive** (new optional/defaulted columns,
new fields inside existing `data` objects, new endpoints) so the mobile app keeps
working on the same responses. Branch: `feat/som-lms-api-additive`.

Frontend consumer types live in
`Frontend/src/utils/api/ministrySchool/interfaces.ts`.

---

## 1. Enrolment source (AUTO / MANUAL) — shipped

**Why:** the admin Learners list and cohort roster show whether a learner was
auto-enrolled (met the criteria on apply) or enrolled by staff.

**Schema:** `enrollment.enrolled_source VARCHAR(10) NOT NULL DEFAULT 'AUTO'`
(migration `20261102120000_add_enrollment_source`). Values: `"AUTO" | "MANUAL"`.
Existing rows and mobile writes default to `AUTO`, so nothing breaks.

**Set at:**
- `EnrollmentService.enrollUser({ ..., source })` — defaults `"AUTO"`.
  - Self-service apply (eligible → auto-enrol): `AUTO` (default).
  - Staff `POST /enroll` endpoint: `"MANUAL"`.
  - Application approval (`ApplicationService.decide`): `"MANUAL"`.

**Surfaced in responses:**
- Gradebook rows — `assessmentService.getGradebook` row: `enrolledSource: "AUTO" | "MANUAL"`.
- `GET /programs-full-details` — each `cohorts[].courses[].enrollments[]` now
  carries `enrolled_source` (Prisma `include` returns it automatically). The FE
  `SomEnrollment` type should add `enrolled_source: "AUTO" | "MANUAL"`.

---

## 2. Program status, grading mode, module count — shipped

**Why:** the Programs table needs Status (Published/Draft), a Grading column
(Weighted / Pass-fail) and "N modules · N units"; the workspace hero shows status.

**Schema (migration `20261102130000_add_program_status_and_hold_grades`):**
- `program.status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED'` — `"DRAFT" | "PUBLISHED"`.
  Defaulted PUBLISHED so existing programs and the mobile catalogue keep visibility.
- `program.hold_grades BOOLEAN NOT NULL DEFAULT false` — opt-in grade hold (see §3).

**Surfaced in `GET /programs-full-details` → `program_details`:**
`status`, `grading_mode` (`"PASS_FAIL" | "WEIGHTED"`, already existed), `pass_mark`,
`module_count` (from `_count.modules`). These also appear top-level via `...program`.
FE `SomProgramFull` should add `status`, `grading_mode`, `pass_mark`, `module_count`.

---

## 3. Per-class delivery details (apply modal) — shipped

**Why:** the apply "choose a class" step shows a mode pill, location and start date.

**`GET /get-member-programs` → each `courses[]`** now also returns (no schema
change — fields already on `course`/`cohort`):
`mode` (= `course.classFormat`: `In_Person | Online | Hybrid | null`),
`location`, `meetingLink`, `startDate` (= the selected cohort's `startDate`).
FE `ClassOption` should add `mode`, `location`, `meetingLink`, `startDate`.

## 4. Library "used in N programs" — shipped

**`GET`** content-library list items already return `usedBy` (unit count); they
now also return `usedInPrograms` = distinct count of programs the item is used in.
(Question-bank per-question usage is NOT relational — questions are copied into a
unit's JSON — so a "used in N" count there needs a join table; deferred.)

---

## 5. Grade release (opt-in hold) — shipped

**Why:** the prototype has a "Release grades" action so learners don't see scores
until staff publish them. Opt-in so default behaviour (and the mobile app) is
unchanged.

**Schema (migration `20261102140000_add_submission_grade_release`):**
`assignment_submission.grade_released BOOLEAN NOT NULL DEFAULT true` + `released_at DATETIME NULL`.
Toggle lives on `program.hold_grades` (§2).

**Grading:** `gradeAssignmentSubmission` and `submitMCQAssignment` set
`grade_released = !program.hold_grades`; when held, `released_at` stays null and
the learner grade notification is deferred.

**New endpoint:** `PUT /release-grades` — body `{ cohortId, topicId?, courseId? }`,
guard `som("grade", … target: cohort)`. Flips held submissions to released (sets
`released_at`), fires the deferred notifications, returns `{ released: <count> }`.

**Learner reads gated** (`learnerService.overview` + `submission`): when a grade is
held, `score/passed/feedback/gradedAt/rubric` come back null, `status:"awaiting_release"`,
quiz correct answers are not revealed, and `progress.score`/pass-fail are concealed —
**all keys preserved** (mobile safety). Known v1 limitation: the `finalGrade`
aggregate in `overview` can still reflect a held component grade.

---

## 6. Learner grade/attendance on rows — shipped

**Why:** the admin "Learners" table wants weighted grade %, attendance % and a
missing-work count per learner, not just completion %.

**`GET /programs-full-details`** (`getAllProgramsWithEnrolledMembersAndCompletion`)
— each `enrolled_members[]` entry now also returns three fields (additive; no
existing key changed, so the mobile app is unaffected):
- `grade_percent` — weighted final grade (`gradebook row.finalGrade`); `null` in
  `PASS_FAIL` mode or when the learner has no counted grade yet.
- `attendance_percent` — attendance % (`row.attendance`); `null` until attendance
  is taken for a session.
- `missing_count` — number of past-due, unsubmitted assignment units
  (`row.missing`); `0` when none / not found.

On `enrolled_members[]` these mirror the gradebook's authoritative computation
(`assessmentService.getGradebook`) and follow the learner's **latest** enrollment
(the same one driving the `cohort`/`class` shown on the row).

The **same three fields** are also added to every per-enrollment object under
`cohorts[].courses[].enrollments[]` (keyed by that enrollment's own id), because
the FE Learners list and cohort roster read the per-enrollment objects rather than
`enrolled_members[]`. Same additive/mobile-safe rules; missing lookup → `null`/`0`.

**Perf:** `getGradebook(cohortId, null)` is called **once per distinct cohort**
that has enrollments (never once per learner); each cohort's rows are keyed by
`enrollmentId` into a map and read back when assembling learner rows. A cohort
whose gradebook throws leaves its learners on `null`/`0` gracefully.

---

## 7. Inline grading comments — shipped

**Why:** the essay grading overlay lets staff drop inline notes (praise / things to
improve, optionally anchored to a quote). The learner's essay result then shows a
Strength / To-improve breakdown. Both need to read/write the same stored comments.

**Storage:** new `assignment_submission.inline_comments Json?` (additive, nullable;
defaults to no value so existing rows and the mobile app are unaffected). Shape:

```ts
type InlineComment = {
  id: string;                        // stable id (server mints one if omitted)
  text: string;                      // the note (required)
  quote?: string;                    // the span it anchors to
  kind?: "praise" | "improve";
};
```

**Payload field — `comments`** on `PUT /grade-with-rubric`:

```jsonc
{
  "submissionId": 123,
  "scores": { "<criterionId>": "<levelId>" },
  "feedback": "…",
  "comments": [{ "id": "c1", "text": "Strong thesis", "quote": "…", "kind": "praise" }]
}
```

`comments` is **optional**. When present it is validated/normalized
(`normalizeInlineComments` in `lms/lmsHttp.ts`) and stored in the **same submission
update** that writes `score`/`feedback`/`rubric_scores`
(`programService.gradeAssignmentSubmission`, via `assessmentService.gradeWithRubric`).
When **omitted** (`undefined`/`null`) the stored `inline_comments` are **left
untouched**.

**Surfaced in two places:**
1. **Staff grading fetch** `GET /submission`
   (`assessmentService.getSubmissionForGrading`) now returns `comments` (array;
   `[]` when none) so the overlay reloads existing notes when reopened.
2. **Learner read** `learnerService.submission` now returns a top-level `comments`
   array, **gated exactly like the other grade fields**: `[]` while the grade is
   held (`grade_released === false`), the stored comments once released. The key is
   always present (mobile safety).

## 8. Program marketing fields — shipped

Three new **program-level** scalars plus a lightweight instructor roster are now
surfaced on the member program catalogue so the learner **program-details** page can
render outcomes, an eligibility blurb, and the people teaching the program.

**Storage (all additive, nullable — existing rows and the mobile app are
unaffected):** new on `program`:

- `learning_outcomes Json?` — array of outcome strings.
- `eligibility_summary String? @db.Text` — short who-can-apply blurb.
- `lead_instructor_id Int?` — the roster user flagged as the lead.
- `lead_instructor_bio String? @db.Text` — bio shown only for the lead.

The teaching roster itself is the existing `program_instructor[]` relation
(`program.instructors_roster`); each row links a `user`.

**Surfaced on** `GET /get-member-programs`
(`programService.getAllProgramForMember`). The query uses `include`, so the new
program scalars come through by default; the `include` was extended to load
`instructors_roster → user (id, name, user_info { first_name, last_name, photo })`.

Each program object in the response gains:

```jsonc
{
  "outcomes": ["Understand covenant theology", "…"], // string[]; [] when none
  "eligibilitySummary": "Open to baptised members…",  // string | null
  "instructors": [
    {
      "id": 42,                 // user id
      "name": "Jane Doe",       // personName(user): user_info name → account name → "Instructor"
      "photo": "https://…",     // user_info.photo ?? null
      "role": null,             // no roster role column yet; always null for now
      "isLead": true,           // user.id === program.lead_instructor_id
      "bio": "15 years in…"     // lead_instructor_bio when isLead, else null
    }
  ]
}
```

All three keys are **always present** (arrays default to `[]`, scalars to `null`),
so the mobile client is safe. The `role` field is reserved for a future roster role
and is `null` until that column exists.

**FE `Programs` type** (`src/utils/api/ministrySchool/interfaces.ts`) adds
`outcomes: string[]`, `eligibilitySummary: string | null`, and
`instructors: { id: number; name: string; photo: string | null; role: string | null; isLead: boolean; bio: string | null }[]`.

---

## 9. Assessment builder — drafts, publish & settings — shipped

**Why:** quizzes and essays are now authored from the program's **Assessments**
tab (and a dedicated builder), not from the curriculum unit form. The builder
can save an assessment as a **draft** (created empty, "add questions next") and
later **publish** it, plus per-assessment settings the prototype shows.

**No schema change.** Everything rides in the existing free-form
`LearningUnit.data` JSON (serialized by `programService`), so existing rows and
the mobile app are unaffected. New optional `data` keys on quiz/essay units:

```ts
type AssessmentSettings = {
  status?: "draft" | "published";  // absent / "published" ⇒ live (back-compat)
  weight?: number;                 // "counts toward final grade" %, authoring aid
  timeLimit?: number | null;       // minutes, null = none
  latePolicy?: "accept" | "penalty" | "lock";  // persisted; submit still locks past-due
  showAnswers?: "immediately" | "after_due" | "never";
  shuffle?: boolean;
};
```

**Validation** (`programService.validateLearningUnit`): when
`data.status === "draft"`, a quiz may have **no questions** and an essay **no
prompt**. Any other status runs the full content validation — so **publishing**
(the FE sends `status: "published"` through `PUT /program/topic`) still requires
≥1 valid question (quiz) or a prompt (essay).

**Draft gating (additive, mobile-safe — default is published):**
- **Submit** (`/submit-mcq-assignment`, `/submit-essay-assignment`): a unit with
  `data.status === "draft"` throws *"This assessment hasn't been published yet"*,
  even if an admin activated it for the cohort.
- **Learner overview** (`learnerService.overview`): draft assessment units are
  hidden — excluded from `progress.total`, `completed`, and `nextTopic`.

**Create / edit / publish all reuse existing endpoints** — no new routes:
- Create a draft: `POST /program/topic` with a quiz/essay unit whose
  `data.status === "draft"`, then `PUT /program/unit-settings`
  (`due_rule`, `grading_category`) for the week-based due rule and category.
- Edit questions & settings, publish/unpublish: `PUT /program/topic` with the
  full unit (`data.status` flipped). `latePolicy` is persisted but submission
  behaviour is unchanged (past-due submissions are already rejected).
