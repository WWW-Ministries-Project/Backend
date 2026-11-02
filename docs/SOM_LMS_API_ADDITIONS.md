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
