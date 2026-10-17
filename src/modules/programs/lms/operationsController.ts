import { applicationService } from "./applicationService";
import { instructorService } from "./instructorService";
import { libraryService } from "./libraryService";
import { assertCohortAbility, assertProgramAbility, facilitatorCohortIds } from "./lmsAccess";
import {
  LmsError,
  lmsHandler,
  optionalDate,
  optionalPositiveInt,
  positiveInt,
  requestUserId,
  requiredText,
} from "./lmsHttp";
import { reportsService } from "./reportsService";
import { ANNOUNCEMENT_AUDIENCES, SESSION_MODES, teachingService, type AnnouncementAudience } from "./teachingService";

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const optionalText = (value: unknown) => (value === undefined ? undefined : text(value));

const ids = (value: unknown, field: string) => {
  const list = Array.isArray(value) ? value : [];
  if (!list.length) throw new LmsError(`${field} must be a non-empty array`);
  return Array.from(new Set(list.map((v) => positiveInt(v, `${field}[]`))));
};

const sessionBody = (body: Record<string, any>, partial: boolean) => {
  const out: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) out.title = requiredText(body.title, "title");
  if (!partial || body.starts_at !== undefined) {
    const starts = optionalDate(body.starts_at, "starts_at");
    if (!starts) throw new LmsError("starts_at is required");
    out.starts_at = starts;
  }
  if (body.ends_at !== undefined) out.ends_at = optionalDate(body.ends_at, "ends_at");
  if (!partial || body.mode !== undefined) {
    if (!SESSION_MODES.includes(body.mode)) throw new LmsError("mode must be IN_PERSON, ONLINE or HYBRID");
    out.mode = body.mode;
  }
  if (body.courseId !== undefined) out.courseId = optionalPositiveInt(body.courseId, "courseId");
  if (body.location !== undefined) out.location = optionalText(body.location);
  if (body.meeting_link !== undefined) out.meeting_link = optionalText(body.meeting_link);
  if (body.notes !== undefined) out.notes = optionalText(body.notes);
  if (body.week !== undefined) out.week = optionalPositiveInt(body.week, "week");
  if (body.cancelled !== undefined) out.cancelled = Boolean(body.cancelled);
  return out;
};

export const operationsController = {
  // Sessions & attendance -----------------------------------------------------
  listSessions: lmsHandler("Sessions fetched", async (req) => {
    const cohortId = optionalPositiveInt(req.query.cohortId, "cohortId");
    if (cohortId) await assertCohortAbility(req, cohortId, "can_attendance");
    // Facilitators listing across cohorts only see cohorts they teach or are rostered on.
    const cohortIds = cohortId ? undefined : await facilitatorCohortIds(req);
    return teachingService.listSessions({
      cohortId: cohortId ?? undefined,
      cohortIds,
      courseId: optionalPositiveInt(req.query.courseId, "courseId") ?? undefined,
      from: optionalDate(req.query.from, "from") ?? undefined,
      to: optionalDate(req.query.to, "to") ?? undefined,
      branchId: req.query.branch_id,
    });
  }),
  createSession: lmsHandler("Session created", async (req) => {
    const cohortId = positiveInt(req.body.cohortId, "cohortId");
    await assertCohortAbility(req, cohortId, "can_attendance");
    return teachingService.createSession(
      { ...(sessionBody(req.body, false) as any), cohortId },
      requestUserId(req),
    );
  }),
  updateSession: lmsHandler("Session updated", async (req) => {
    const id = positiveInt(req.query.id, "id");
    const session = await teachingService.getSession(id);
    await assertCohortAbility(req, session.cohortId, "can_attendance");
    return teachingService.updateSession(id, sessionBody(req.body, true));
  }),
  deleteSession: lmsHandler("Session deleted", async (req) => {
    const id = positiveInt(req.query.id, "id");
    const session = await teachingService.getSession(id);
    await assertCohortAbility(req, session.cohortId, "can_attendance");
    return teachingService.deleteSession(id);
  }),
  getAttendance: lmsHandler("Attendance fetched", async (req) => {
    const sessionId = positiveInt(req.query.sessionId, "sessionId");
    const session = await teachingService.getSession(sessionId);
    await assertCohortAbility(req, session.cohortId, "can_attendance");
    return teachingService.getSessionAttendance(sessionId);
  }),
  saveAttendance: lmsHandler("Attendance saved", async (req) => {
    const sessionId = positiveInt(req.body.sessionId, "sessionId");
    const session = await teachingService.getSession(sessionId);
    await assertCohortAbility(req, session.cohortId, "can_attendance");
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    if (!records.length) throw new LmsError("records must be a non-empty array");
    return teachingService.saveAttendance(
      sessionId,
      records.map((r: any) => ({
        enrollmentId: positiveInt(r?.enrollmentId, "records[].enrollmentId"),
        status: String(r?.status ?? ""),
        note: text(r?.note),
      })),
      requestUserId(req),
    );
  }),

  // Announcements --------------------------------------------------------------
  listAnnouncements: lmsHandler("Announcements fetched", async (req) => {
    const cohortId = positiveInt(req.query.cohortId, "cohortId");
    await assertCohortAbility(req, cohortId, "can_message");
    return teachingService.listAnnouncements(cohortId);
  }),
  createAnnouncement: lmsHandler("Announcement sent", async (req) => {
    const cohortId = positiveInt(req.body.cohortId, "cohortId");
    await assertCohortAbility(req, cohortId, "can_message");
    const audience = String(req.body.audience ?? "COHORT") as AnnouncementAudience;
    if (!ANNOUNCEMENT_AUDIENCES.includes(audience)) throw new LmsError("audience must be COHORT, CLASS or AT_RISK");
    const channels = req.body.channels ?? {};
    return teachingService.createAnnouncement(
      {
        cohortId,
        courseId: optionalPositiveInt(req.body.courseId, "courseId"),
        audience,
        title: requiredText(req.body.title, "title"),
        body: requiredText(req.body.body, "body", 5000),
        channels: { inApp: channels.inApp !== false, email: channels.email === true, sms: channels.sms === true },
        scheduledFor: text(req.body.scheduledFor),
      },
      requestUserId(req),
    );
  }),

  // Applications ---------------------------------------------------------------
  apply: lmsHandler("Application received", (req) => {
    const userId = requestUserId(req);
    if (!userId) throw new LmsError("Sign in to apply", 401);
    return applicationService.apply(userId, positiveInt(req.body.courseId, "courseId"), text(req.body.note));
  }),
  checkEligibility: lmsHandler("Eligibility checked", async (req) => {
    const userId = requestUserId(req);
    if (!userId) throw new LmsError("Sign in to apply", 401);
    const result = await applicationService.checkEligibility(userId, positiveInt(req.query.courseId, "courseId"));
    return { eligible: !result.reasons.length && !result.alreadyEnrolled, alreadyEnrolled: result.alreadyEnrolled, reasons: result.reasons };
  }),
  listApplications: lmsHandler("Applications fetched", (req) =>
    applicationService.list({
      status: text(req.query.status) ?? undefined,
      programId: optionalPositiveInt(req.query.programId, "programId") ?? undefined,
      branchId: req.query.branch_id,
    }),
  ),
  decideApplication: lmsHandler("Application decided", (req) => {
    const decision = String(req.body.decision ?? "");
    if (decision !== "APPROVE" && decision !== "DECLINE") throw new LmsError("decision must be APPROVE or DECLINE");
    return applicationService.decide({
      id: positiveInt(req.body.id, "id"),
      decision,
      courseId: optionalPositiveInt(req.body.courseId, "courseId"),
      note: text(req.body.note),
      actorUserId: requestUserId(req),
    });
  }),

  // Instructors -----------------------------------------------------------------
  listRoster: lmsHandler("Instructors fetched", async (req) => {
    const programId = positiveInt(req.query.programId, "programId");
    await assertProgramAbility(req, programId, "can_grade");
    return instructorService.listRoster(programId);
  }),
  addToRoster: lmsHandler("Instructors added", (req) =>
    instructorService.addToRoster(
      positiveInt(req.body.programId, "programId"),
      ids(req.body.userIds, "userIds"),
      req.body ?? {},
      requestUserId(req),
    ),
  ),
  updateRoster: lmsHandler("Instructor updated", (req) =>
    instructorService.updateRoster(positiveInt(req.query.id, "id"), req.body ?? {}),
  ),
  removeFromRoster: lmsHandler("Instructor removed", (req) =>
    instructorService.removeFromRoster(positiveInt(req.query.id, "id")),
  ),
  instructorsOverview: lmsHandler("Instructors fetched", (req) => instructorService.overview(req.query.branch_id)),

  // Content library ---------------------------------------------------------------
  listLibrary: lmsHandler("Library fetched", (req) =>
    libraryService.list({
      search: text(req.query.search) ?? undefined,
      type: text(req.query.type) ?? undefined,
      tag: text(req.query.tag) ?? undefined,
    }),
  ),
  createLibraryItem: lmsHandler("Item added", (req) => libraryService.create(req.body ?? {}, requestUserId(req))),
  updateLibraryItem: lmsHandler("Item updated", (req) =>
    libraryService.update(positiveInt(req.query.id, "id"), req.body ?? {}),
  ),
  deleteLibraryItem: lmsHandler("Item deleted", (req) => libraryService.remove(positiveInt(req.query.id, "id"))),
  useLibraryItem: lmsHandler("Unit added", (req) =>
    libraryService.useInProgram({
      itemId: positiveInt(req.body.itemId, "itemId"),
      programId: positiveInt(req.body.programId, "programId"),
      moduleId: optionalPositiveInt(req.body.moduleId, "moduleId"),
      title: text(req.body.title),
    }),
  ),

  // Reports ------------------------------------------------------------------------
  reports: lmsHandler("Reports fetched", (req) =>
    reportsService.summary({
      branchId: req.query.branch_id,
      from: optionalDate(req.query.from, "from") ?? undefined,
      to: optionalDate(req.query.to, "to") ?? undefined,
    }),
  ),
};
