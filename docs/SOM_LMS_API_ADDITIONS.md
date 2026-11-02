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
