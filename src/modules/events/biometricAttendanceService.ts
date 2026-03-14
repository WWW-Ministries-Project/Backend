import axios from "axios";
import { Prisma, biometric_import_job_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  buildZtecoServiceRequestConfig,
  getZtecoServiceUrl,
} from "../integrationUtils/ztecoServiceClient";

type ImportActor = {
  id: number;
};

type ImportDeviceInput = {
  id?: unknown;
  ip?: unknown;
  port?: unknown;
};

type ImportRequest = {
  eventId?: unknown;
  event_id?: unknown;
  date?: unknown;
  deviceIds?: unknown;
  device_ids?: unknown;
  devices?: unknown;
  leadTimeMinutes?: unknown;
  lead_time_minutes?: unknown;
  dryRun?: unknown;
  dry_run?: unknown;
};

type ResolvedDevice = {
  id: number | null;
  ip: string;
  port: number | null;
};

type MinimalUser = {
  id: number;
  name: string;
  member_id: string | null;
};

type AttendancePunch = {
  event_mgt_id: number;
  device_id: number | null;
  device_ip: string;
  device_port: string | null;
  device_user_id: string;
  device_user_name: string | null;
  matched_user_id: number | null;
  matched_member_id: string | null;
  matched_user_name: string | null;
  record_time: Date;
  state: number;
  raw_payload: Prisma.InputJsonValue;
  imported_by: number;
  imported_by_name: string;
};

type AttendanceCandidate = {
  user_id: number;
  created_at: Date;
  day_key: string;
};

type MatchSummaryRow = {
  device_user_id: string;
  device_user_name: string | null;
  punch_count: number;
  device_ips: string[];
};

type EventWindow = {
  eventName: string | null;
  eventType: string | null;
  occurrenceDate: string;
  start: Date;
  end: Date;
  leadTimeMinutes: number;
};

type ImportResult = {
  dry_run: boolean;
  event: {
    id: number;
    event_name: string | null;
    event_type: string | null;
  };
  occurrence_date: string;
  attendance_window: {
    start: string;
    end: string;
    lead_time_minutes: number;
  };
  devices_requested: Array<{
    id: number | null;
    ip: string;
    port: number | null;
  }>;
  totals: {
    punches_fetched: number;
    punches_within_window: number;
    unique_punches: number;
    duplicate_punches_skipped: number;
    punches_staged_new: number;
    punches_reconciled_to_users: number;
    punches_matched_to_users: number;
    punches_unmatched: number;
    attendance_candidates: number;
    attendance_rows_created: number;
    attendance_rows_existing: number;
  };
  unmatched_device_users: MatchSummaryRow[];
};

type ImportJobProgress = {
  total_devices: number;
  processed_devices: number;
  raw_punches_fetched: number;
  punches_within_window: number;
  unique_punches: number;
  duplicate_punches_skipped: number;
  punches_staged_new: number;
  punches_reconciled_to_users: number;
  punches_matched_to_users: number;
  punches_unmatched: number;
  attendance_candidates: number;
  attendance_rows_created: number;
  attendance_rows_existing: number;
};

type ImportJobSnapshot = {
  id: number;
  event_id: number;
  event_name: string | null;
  occurrence_date: string;
  dry_run: boolean;
  status: biometric_import_job_status;
  progress_percentage: number;
  current_step: string | null;
  progress: ImportJobProgress;
  result: ImportResult | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};

type ImportProgressReporter = (update: {
  percentage?: number;
  step?: string;
  patch?: Partial<ImportJobProgress>;
}) => Promise<void>;

class UserMatcher {
  private readonly exactIdMap = new Map<string, MinimalUser | null>();
  private readonly exactMemberIdMap = new Map<string, MinimalUser | null>();
  private readonly memberIdSuffixMap = new Map<string, MinimalUser | null>();

  constructor(users: MinimalUser[]) {
    for (const user of users) {
      this.addUniqueEntry(this.exactIdMap, String(user.id), user);

      const memberId = this.normalizeIdentifier(user.member_id);
      if (!memberId) continue;

      this.addUniqueEntry(this.exactMemberIdMap, memberId, user);
      this.addUniqueEntry(this.memberIdSuffixMap, memberId.slice(-8), user);
    }
  }

  resolve(deviceUserId: string): MinimalUser | null {
    const normalizedId = this.normalizeIdentifier(deviceUserId);
    if (!normalizedId) {
      return null;
    }

    return (
      this.readUniqueEntry(this.exactIdMap, normalizedId) ||
      this.readUniqueEntry(this.exactMemberIdMap, normalizedId) ||
      this.readUniqueEntry(this.memberIdSuffixMap, normalizedId.slice(-8))
    );
  }

  private normalizeIdentifier(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  private addUniqueEntry(
    map: Map<string, MinimalUser | null>,
    key: string,
    user: MinimalUser,
  ) {
    const normalizedKey = this.normalizeIdentifier(key);
    if (!normalizedKey) return;

    const existing = map.get(normalizedKey);
    if (!existing) {
      map.set(normalizedKey, user);
      return;
    }

    if (existing.id !== user.id) {
      map.set(normalizedKey, null);
    }
  }

  private readUniqueEntry(
    map: Map<string, MinimalUser | null>,
    key: string,
  ): MinimalUser | null {
    const entry = map.get(key);
    return entry ?? null;
  }
}

export class EventBiometricAttendanceImportError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "EventBiometricAttendanceImportError";
  }
}

export class EventBiometricAttendanceService {
  private readonly activeJobIds = new Set<number>();

  private readonly defaultLeadTimeMinutes = this.parsePositiveEnvInt(
    process.env.BIOMETRIC_EVENT_LEAD_TIME_MINUTES,
    120,
  );

  private readonly ztecoServiceTimeoutMs = this.parsePositiveEnvInt(
    process.env.ZTECO_SERVICE_TIMEOUT_MS,
    120_000,
  );

  async createImportJob(request: ImportRequest, actor: ImportActor) {
    const context = await this.resolveImportContext(request, actor);
    const occurrenceDate = this.toOccurrenceDate(context.window.occurrenceDate);

    const existingJob = await prisma.event_biometric_import_job.findFirst({
      where: {
        event_mgt_id: context.event.id,
        occurrence_date: occurrenceDate,
        dry_run: context.dryRun,
        status: {
          in: [
            biometric_import_job_status.QUEUED,
            biometric_import_job_status.RUNNING,
          ],
        },
      },
      include: {
        event: {
          select: {
            event: {
              select: {
                event_name: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (existingJob) {
      if (
        existingJob.status === biometric_import_job_status.QUEUED &&
        !this.activeJobIds.has(existingJob.id)
      ) {
        this.startImportJob(existingJob.id);
      }

      return this.mapImportJob(existingJob);
    }

    const requestPayload = this.toJsonPayload({
      ...request,
      eventId: context.event.id,
      date: context.window.occurrenceDate,
      dryRun: context.dryRun,
      leadTimeMinutes: context.window.leadTimeMinutes,
    });

    const job = await prisma.event_biometric_import_job.create({
      data: {
        event_mgt_id: context.event.id,
        occurrence_date: occurrenceDate,
        dry_run: context.dryRun,
        status: biometric_import_job_status.QUEUED,
        progress_percentage: 0,
        current_step: "Queued",
        progress_payload: this.toJsonPayload(this.createEmptyProgress()),
        request_payload: requestPayload,
        created_by: context.actorUser.id,
        created_by_name: context.actorUser.name,
      },
      include: {
        event: {
          select: {
            event: {
              select: {
                event_name: true,
              },
            },
          },
        },
      },
    });

    this.startImportJob(job.id);

    return this.mapImportJob(job);
  }

  async getImportJob(jobId: number) {
    const job = await prisma.event_biometric_import_job.findUnique({
      where: {
        id: jobId,
      },
      include: {
        event: {
          select: {
            event: {
              select: {
                event_name: true,
              },
            },
          },
        },
      },
    });

    if (!job) {
      throw new EventBiometricAttendanceImportError(
        "Biometric attendance import job not found",
        404,
      );
    }

    if (
      job.status === biometric_import_job_status.QUEUED &&
      !this.activeJobIds.has(job.id)
    ) {
      this.startImportJob(job.id);
    }

    return this.mapImportJob(job);
  }

  async importEventAttendance(request: ImportRequest, actor: ImportActor) {
    const context = await this.resolveImportContext(request, actor);
    return this.runImportPipeline(
      request,
      {
        id: context.actorUser.id,
        name: context.actorUser.name,
      },
      context,
    );
  }

  private startImportJob(jobId: number) {
    if (this.activeJobIds.has(jobId)) {
      return;
    }

    this.activeJobIds.add(jobId);
    setImmediate(() => {
      void this.processImportJob(jobId);
    });
  }

  private async processImportJob(jobId: number) {
    const progressState = this.createEmptyProgress();

    try {
      const job = await prisma.event_biometric_import_job.findUnique({
        where: {
          id: jobId,
        },
      });

      if (!job) {
        throw new EventBiometricAttendanceImportError(
          "Biometric attendance import job not found",
          404,
        );
      }

      if (
        job.status === biometric_import_job_status.COMPLETED ||
        job.status === biometric_import_job_status.FAILED
      ) {
        return;
      }

      Object.assign(progressState, this.parseJobProgress(job.progress_payload));

      await this.persistJobState(jobId, {
        status: biometric_import_job_status.RUNNING,
        percentage: Math.max(job.progress_percentage, 5),
        step: job.current_step || "Starting bulk import",
        progress: progressState,
        startedAt: job.started_at ?? new Date(),
        errorMessage: null,
      });

      const request = this.parseImportRequest(job.request_payload);
      const context = await this.resolveImportContext(request, {
        id: job.created_by,
      });

      const reportProgress: ImportProgressReporter = async (update) => {
        Object.assign(progressState, update.patch || {});

        await this.persistJobState(jobId, {
          status: biometric_import_job_status.RUNNING,
          percentage: update.percentage,
          step: update.step,
          progress: progressState,
          startedAt: job.started_at ?? new Date(),
        });
      };

      const result = await this.runImportPipeline(
        request,
        {
          id: context.actorUser.id,
          name: context.actorUser.name,
        },
        context,
        reportProgress,
      );

      await this.persistJobState(jobId, {
        status: biometric_import_job_status.COMPLETED,
        percentage: 100,
        step: result.dry_run ? "Preview completed" : "Bulk import completed",
        progress: {
          ...progressState,
          punches_within_window: result.totals.punches_within_window,
          unique_punches: result.totals.unique_punches,
          duplicate_punches_skipped: result.totals.duplicate_punches_skipped,
          punches_staged_new: result.totals.punches_staged_new,
          punches_reconciled_to_users:
            result.totals.punches_reconciled_to_users,
          punches_matched_to_users: result.totals.punches_matched_to_users,
          punches_unmatched: result.totals.punches_unmatched,
          attendance_candidates: result.totals.attendance_candidates,
          attendance_rows_created: result.totals.attendance_rows_created,
          attendance_rows_existing: result.totals.attendance_rows_existing,
        },
        result,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });
    } catch (error: any) {
      const normalizedError =
        error instanceof EventBiometricAttendanceImportError
          ? error.message
          : error?.message || "Unable to import biometric attendance";

      await this.persistJobState(jobId, {
        status: biometric_import_job_status.FAILED,
        percentage: 100,
        step: "Bulk import failed",
        progress: progressState,
        failedAt: new Date(),
        errorMessage: normalizedError,
      });
    } finally {
      this.activeJobIds.delete(jobId);
    }
  }

  private async resolveImportContext(request: ImportRequest, actor: ImportActor) {
    const eventId = this.toPositiveInt(request?.eventId ?? request?.event_id);
    if (!eventId) {
      throw new EventBiometricAttendanceImportError("eventId is required");
    }

    const dryRun = this.toBoolean(request?.dryRun ?? request?.dry_run);
    const event = await prisma.event_mgt.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        start_date: true,
        end_date: true,
        start_time: true,
        end_time: true,
        event_type: true,
        event: {
          select: {
            event_name: true,
          },
        },
      },
    });

    if (!event) {
      throw new EventBiometricAttendanceImportError("Event not found", 404);
    }

    const actorUser = await prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!actorUser) {
      throw new EventBiometricAttendanceImportError(
        "Authenticated user not found",
        401,
      );
    }

    const leadTimeMinutes =
      this.toPositiveInt(
        request?.leadTimeMinutes ?? request?.lead_time_minutes,
      ) ||
      this.defaultLeadTimeMinutes;

    const window = this.buildEventWindow(event, request?.date, leadTimeMinutes);

    return {
      dryRun,
      event,
      actorUser,
      window,
    };
  }

  private async runImportPipeline(
    request: ImportRequest,
    actor: { id: number; name: string },
    resolvedContext?: Awaited<
      ReturnType<EventBiometricAttendanceService["resolveImportContext"]>
    >,
    reportProgress?: ImportProgressReporter,
  ): Promise<ImportResult> {
    const context =
      resolvedContext || (await this.resolveImportContext(request, actor));
    const { dryRun, event, actorUser, window } = context;

    await reportProgress?.({
      percentage: 10,
      step: "Resolving devices",
    });

    const devices = await this.resolveDevices(request);

    await reportProgress?.({
      percentage: 15,
      step: `Fetching punches from ${devices.length} device${
        devices.length === 1 ? "" : "s"
      }`,
      patch: {
        total_devices: devices.length,
        processed_devices: 0,
      },
    });

    const rawPunches = await this.fetchPunchesFromZteco(
      devices,
      window,
      reportProgress,
    );
    const matcher = await this.buildUserMatcher();

    await reportProgress?.({
      percentage: 55,
      step: "Normalizing and deduplicating punches",
      patch: {
        raw_punches_fetched: rawPunches.length,
      },
    });

    const normalizedPunches = this.normalizePunches({
      actor: actorUser,
      eventId: event.id,
      matcher,
      rawPunches,
      devices,
      window,
    });
    const dedupedPunches = this.dedupePunches(normalizedPunches);
    const uniquePunches = dedupedPunches.punches;

    await reportProgress?.({
      percentage: 60,
      step: dryRun ? "Building preview set" : "Staging unique punches",
      patch: {
        punches_within_window: normalizedPunches.length,
        unique_punches: uniquePunches.length,
        duplicate_punches_skipped: dedupedPunches.duplicateCount,
      },
    });

    let stagedNewCount = 0;
    let upgradedMatchCount = 0;
    if (!dryRun && uniquePunches.length > 0) {
      const persistResult = await this.persistPunches(uniquePunches, reportProgress);
      stagedNewCount = persistResult.createdCount;
      upgradedMatchCount = persistResult.upgradedMatchCount;
    }

    const stagedPunchesRaw = dryRun
      ? uniquePunches
      : await prisma.event_biometric_punch.findMany({
          where: {
            event_mgt_id: event.id,
            record_time: {
              gte: window.start,
              lte: window.end,
            },
          },
          orderBy: {
            record_time: "asc",
          },
        });
    const stagedPunches = this.dedupePunches(stagedPunchesRaw as AttendancePunch[])
      .punches;

    const matchedPunchCount = stagedPunches.filter(
      (punch) => this.toPositiveInt(punch.matched_user_id) !== null,
    ).length;

    await reportProgress?.({
      percentage: 85,
      step: "Computing attendance candidates",
      patch: {
        punches_staged_new: stagedNewCount,
        punches_reconciled_to_users: upgradedMatchCount,
        punches_matched_to_users: matchedPunchCount,
        punches_unmatched: stagedPunches.length - matchedPunchCount,
      },
    });

    const attendanceCandidates = this.buildAttendanceCandidates(stagedPunches);
    const attendanceResult = await this.persistAttendanceRows({
      eventId: event.id,
      candidates: attendanceCandidates,
      dryRun,
    });
    const unmatchedUsers = this.buildUnmatchedSummary(stagedPunches);

    const result: ImportResult = {
      dry_run: dryRun,
      event: {
        id: event.id,
        event_name: window.eventName,
        event_type: window.eventType,
      },
      occurrence_date: window.occurrenceDate,
      attendance_window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        lead_time_minutes: window.leadTimeMinutes,
      },
      devices_requested: devices.map((device) => ({
        id: device.id,
        ip: device.ip,
        port: device.port,
      })),
      totals: {
        punches_fetched: rawPunches.length,
        punches_within_window: normalizedPunches.length,
        unique_punches: uniquePunches.length,
        duplicate_punches_skipped: dedupedPunches.duplicateCount,
        punches_staged_new: stagedNewCount,
        punches_reconciled_to_users: upgradedMatchCount,
        punches_matched_to_users: matchedPunchCount,
        punches_unmatched: stagedPunches.length - matchedPunchCount,
        attendance_candidates: attendanceCandidates.length,
        attendance_rows_created: attendanceResult.createdCount,
        attendance_rows_existing: attendanceResult.existingCount,
      },
      unmatched_device_users: unmatchedUsers,
    };

    await reportProgress?.({
      percentage: 95,
      step: dryRun ? "Preview ready" : "Finalizing bulk import",
      patch: {
        attendance_candidates: attendanceCandidates.length,
        attendance_rows_created: attendanceResult.createdCount,
        attendance_rows_existing: attendanceResult.existingCount,
      },
    });

    return result;
  }

  private createEmptyProgress(): ImportJobProgress {
    return {
      total_devices: 0,
      processed_devices: 0,
      raw_punches_fetched: 0,
      punches_within_window: 0,
      unique_punches: 0,
      duplicate_punches_skipped: 0,
      punches_staged_new: 0,
      punches_reconciled_to_users: 0,
      punches_matched_to_users: 0,
      punches_unmatched: 0,
      attendance_candidates: 0,
      attendance_rows_created: 0,
      attendance_rows_existing: 0,
    };
  }

  private parseJobProgress(value: unknown): ImportJobProgress {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return this.createEmptyProgress();
    }

    const record = value as Record<string, unknown>;
    return {
      total_devices: this.toNonNegativeInt(record.total_devices),
      processed_devices: this.toNonNegativeInt(record.processed_devices),
      raw_punches_fetched: this.toNonNegativeInt(record.raw_punches_fetched),
      punches_within_window: this.toNonNegativeInt(record.punches_within_window),
      unique_punches: this.toNonNegativeInt(record.unique_punches),
      duplicate_punches_skipped: this.toNonNegativeInt(
        record.duplicate_punches_skipped,
      ),
      punches_staged_new: this.toNonNegativeInt(record.punches_staged_new),
      punches_reconciled_to_users: this.toNonNegativeInt(
        record.punches_reconciled_to_users,
      ),
      punches_matched_to_users: this.toNonNegativeInt(
        record.punches_matched_to_users,
      ),
      punches_unmatched: this.toNonNegativeInt(record.punches_unmatched),
      attendance_candidates: this.toNonNegativeInt(record.attendance_candidates),
      attendance_rows_created: this.toNonNegativeInt(
        record.attendance_rows_created,
      ),
      attendance_rows_existing: this.toNonNegativeInt(
        record.attendance_rows_existing,
      ),
    };
  }

  private parseImportRequest(value: unknown): ImportRequest {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return value as ImportRequest;
  }

  private parseImportResult(value: unknown): ImportResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as ImportResult;
  }

  private mapImportJob(job: any): ImportJobSnapshot {
    const progress = this.parseJobProgress(job.progress_payload);
    const result = this.parseImportResult(job.result_payload);

    return {
      id: job.id,
      event_id: job.event_mgt_id,
      event_name: result?.event?.event_name || job.event?.event?.event_name || null,
      occurrence_date:
        result?.occurrence_date ||
        (job.occurrence_date instanceof Date
          ? job.occurrence_date.toISOString().slice(0, 10)
          : this.normalizeText(job.occurrence_date)),
      dry_run: Boolean(job.dry_run),
      status: job.status,
      progress_percentage: this.toNonNegativeInt(job.progress_percentage),
      current_step: job.current_step || null,
      progress,
      result,
      error_message: job.error_message || null,
      created_at: job.created_at.toISOString(),
      started_at: job.started_at ? job.started_at.toISOString() : null,
      completed_at: job.completed_at ? job.completed_at.toISOString() : null,
      failed_at: job.failed_at ? job.failed_at.toISOString() : null,
    };
  }

  private async persistJobState(
    jobId: number,
    args: {
      status?: biometric_import_job_status;
      percentage?: number;
      step?: string;
      progress?: ImportJobProgress;
      result?: ImportResult | null;
      errorMessage?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
      failedAt?: Date | null;
    },
  ) {
    const data: Record<string, unknown> = {};

    if (args.status) {
      data.status = args.status;
    }

    if (typeof args.percentage === "number") {
      data.progress_percentage = Math.max(0, Math.min(100, Math.round(args.percentage)));
    }

    if (args.step !== undefined) {
      data.current_step = args.step;
    }

    if (args.progress) {
      data.progress_payload = this.toJsonPayload(args.progress);
    }

    if (args.result !== undefined) {
      data.result_payload = args.result ? this.toJsonPayload(args.result) : null;
    }

    if (args.errorMessage !== undefined) {
      data.error_message = args.errorMessage;
    }

    if (args.startedAt !== undefined) {
      data.started_at = args.startedAt;
    }

    if (args.completedAt !== undefined) {
      data.completed_at = args.completedAt;
    }

    if (args.failedAt !== undefined) {
      data.failed_at = args.failedAt;
    }

    await prisma.event_biometric_import_job.update({
      where: {
        id: jobId,
      },
      data,
    });
  }

  private parsePositiveEnvInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  private toPositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  private toNonNegativeInt(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  private toOccurrenceDate(dayKey: string): Date {
    return new Date(`${dayKey}T00:00:00.000Z`);
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();

    return ["true", "1", "yes", "on"].includes(normalized);
  }

  private normalizeText(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  private normalizeNullableText(value: unknown): string | null {
    const normalized = this.normalizeText(value);
    return normalized || null;
  }

  private toUtcDayKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private parseIsoDate(value: unknown): Date | null {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  private formatTimeParts(value: Date): string {
    const hours = String(value.getUTCHours()).padStart(2, "0");
    const minutes = String(value.getUTCMinutes()).padStart(2, "0");
    const seconds = String(value.getUTCSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  private normalizeTimeText(
    value: unknown,
    fallback: string,
  ): string {
    const normalized = this.normalizeText(value);
    if (!normalized) return fallback;

    const timeMatch = normalized.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    if (timeMatch?.[1]) {
      const [hours, minutes, seconds = "00"] = timeMatch[1].split(":");
      return `${hours.padStart(2, "0")}:${minutes}:${seconds}`;
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return this.formatTimeParts(parsed);
    }

    return fallback;
  }

  private combineDateAndTime(
    dayKey: string,
    timeValue: unknown,
    fallbackTime: string,
  ): Date {
    const normalizedTime = this.normalizeTimeText(timeValue, fallbackTime);
    return new Date(`${dayKey}T${normalizedTime}.000Z`);
  }

  private buildEventWindow(
    event: {
      start_date: Date | null;
      end_date: Date | null;
      start_time: string | null;
      end_time: string | null;
      event_type: string | null;
      event: { event_name: string | null } | null;
    },
    requestedDate: unknown,
    leadTimeMinutes: number,
  ): EventWindow {
    const baseStartDate =
      this.parseIsoDate(requestedDate) ||
      event.start_date ||
      event.end_date;

    if (!baseStartDate) {
      throw new EventBiometricAttendanceImportError(
        "Event does not have a valid start date and no import date was provided",
      );
    }

    const originalStartDate = event.start_date || baseStartDate;
    const originalEndDate = event.end_date || originalStartDate;
    const durationMs = Math.max(
      0,
      originalEndDate.getTime() - originalStartDate.getTime(),
    );
    const occurrenceDate = this.toUtcDayKey(baseStartDate);
    const endOccurrenceDate = this.toUtcDayKey(
      new Date(baseStartDate.getTime() + durationMs),
    );

    const start = this.combineDateAndTime(
      occurrenceDate,
      event.start_time ?? this.formatTimeParts(originalStartDate),
      "00:00:00",
    );
    let end = this.combineDateAndTime(
      endOccurrenceDate,
      event.end_time ?? this.formatTimeParts(originalEndDate),
      "23:59:59",
    );

    if (end.getTime() < start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    const windowStart = new Date(start.getTime() - leadTimeMinutes * 60 * 1000);

    return {
      eventName: event.event?.event_name ?? null,
      eventType: event.event_type ?? null,
      occurrenceDate,
      start: windowStart,
      end,
      leadTimeMinutes,
    };
  }

  private parseDeviceInputs(value: unknown): ResolvedDevice[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((device): ResolvedDevice | null => {
        const typedDevice = device as ImportDeviceInput;
        const ip = this.normalizeText(typedDevice?.ip);
        if (!ip) return null;

        const id = this.toPositiveInt(typedDevice?.id);
        const port = this.toPositiveInt(typedDevice?.port);

        return {
          id,
          ip,
          port,
        };
      })
      .filter((device): device is ResolvedDevice => Boolean(device));
  }

  private parsePositiveIntArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];

    return Array.from(
      new Set(
        value
          .map((entry) => this.toPositiveInt(entry))
          .filter((entry): entry is number => Boolean(entry)),
      ),
    );
  }

  private async resolveDevices(request: ImportRequest): Promise<ResolvedDevice[]> {
    const manualDevices = this.parseDeviceInputs(request?.devices);
    const requestedDeviceIds = this.parsePositiveIntArray(
      request?.deviceIds ?? request?.device_ids,
    );
    const devicesByKey = new Map<string, ResolvedDevice>();

    const addDevice = (device: ResolvedDevice) => {
      const key = `${device.ip}:${device.port ?? ""}`;
      devicesByKey.set(key, device);
    };

    for (const device of manualDevices) {
      addDevice(device);
    }

    const shouldLoadSavedDevices =
      requestedDeviceIds.length > 0 || devicesByKey.size === 0;

    if (shouldLoadSavedDevices) {
      const savedDevices = await prisma.devices.findMany({
        where: requestedDeviceIds.length
          ? {
              id: {
                in: requestedDeviceIds,
              },
            }
          : undefined,
        select: {
          id: true,
          ip_address: true,
          port: true,
        },
      });

      for (const device of savedDevices) {
        const port = this.toPositiveInt(device.port);
        addDevice({
          id: device.id,
          ip: this.normalizeText(device.ip_address),
          port,
        });
      }
    }

    const devices = Array.from(devicesByKey.values()).filter(
      (device) => device.ip,
    );

    if (!devices.length) {
      throw new EventBiometricAttendanceImportError(
        "No devices were resolved for biometric attendance import",
      );
    }

    return devices;
  }

  private async fetchPunchesFromZteco(
    devices: ResolvedDevice[],
    window: EventWindow,
    reportProgress?: ImportProgressReporter,
  ): Promise<Record<string, unknown>[]> {
    const allPunches: Record<string, unknown>[] = [];

    for (let index = 0; index < devices.length; index += 1) {
      const device = devices[index];
      const devicePunches = await this.fetchPunchesForDevice(device, window);
      allPunches.push(...devicePunches);

      await reportProgress?.({
        percentage: 15 + Math.round(((index + 1) / devices.length) * 30),
        step: `Fetched ${index + 1} of ${devices.length} device${
          devices.length === 1 ? "" : "s"
        }`,
        patch: {
          total_devices: devices.length,
          processed_devices: index + 1,
          raw_punches_fetched: allPunches.length,
        },
      });
    }

    return allPunches;
  }

  private async fetchPunchesForDevice(
    device: ResolvedDevice,
    window: EventWindow,
  ): Promise<Record<string, unknown>[]> {
    const config = {
      ...buildZtecoServiceRequestConfig(),
      timeout: this.ztecoServiceTimeoutMs,
    };

    try {
      const response = await axios.post(
        getZtecoServiceUrl("/zteco/internal/get-attendance"),
        {
          devices: [
            {
              ip: device.ip,
              ...(device.port ? { port: device.port } : {}),
            },
          ],
          startTime: window.start.toISOString(),
          endTime: window.end.toISOString(),
        },
        config,
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        throw new EventBiometricAttendanceImportError(
          error?.response?.data?.message ||
            error?.message ||
            `Failed to fetch attendance from ${device.ip}`,
          error?.response?.status || 502,
        );
      }
    }

    try {
      const response = await axios.post(
        getZtecoServiceUrl("/zteco/get-attendance"),
        [
          {
            ip: device.ip,
            ...(device.port ? { port: device.port } : {}),
          },
        ],
        config,
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      throw new EventBiometricAttendanceImportError(
        error?.response?.data?.message ||
          error?.message ||
          `Failed to fetch attendance from ${device.ip}`,
        error?.response?.status || 502,
      );
    }
  }

  private async buildUserMatcher(): Promise<UserMatcher> {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        member_id: true,
      },
    });

    return new UserMatcher(users);
  }

  private parseRecordTime(record: Record<string, unknown>): Date | null {
    const candidateValues = [
      record?.record_time,
      record?.timestamp,
      record?.record_time_ms,
      record?.recordTime,
    ];

    for (const candidate of candidateValues) {
      if (candidate === null || candidate === undefined) continue;

      const parsed =
        typeof candidate === "number"
          ? new Date(candidate)
          : new Date(String(candidate));

      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  }

  private toJsonPayload(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private normalizePunches(args: {
    actor: { id: number; name: string };
    eventId: number;
    matcher: UserMatcher;
    rawPunches: Record<string, unknown>[];
    devices: ResolvedDevice[];
    window: EventWindow;
  }): AttendancePunch[] {
    const deviceByIp = new Map<string, ResolvedDevice>();
    for (const device of args.devices) {
      deviceByIp.set(device.ip, device);
    }

    return args.rawPunches
      .map((record): AttendancePunch | null => {
        const deviceIp = this.normalizeText(record?.ip ?? record?.device_ip);
        const recordTime = this.parseRecordTime(record);
        const deviceUserId = this.normalizeText(
          record?.user_Id ??
            record?.user_id ??
            record?.userId ??
            record?.uid ??
            record?.userid,
        );

        if (!recordTime || !deviceUserId || !deviceIp) {
          return null;
        }

        if (
          recordTime.getTime() < args.window.start.getTime() ||
          recordTime.getTime() > args.window.end.getTime()
        ) {
          return null;
        }

        const matchedUser = args.matcher.resolve(deviceUserId);
        const device = deviceByIp.get(deviceIp);
        const parsedState = Number(record?.state);

        return {
          event_mgt_id: args.eventId,
          device_id: device?.id ?? null,
          device_ip: deviceIp,
          device_port:
            device?.port !== null && device?.port !== undefined
              ? String(device.port)
              : null,
          device_user_id: deviceUserId,
          device_user_name: this.normalizeNullableText(
            record?.user_name ?? record?.name,
          ),
          matched_user_id: matchedUser?.id ?? null,
          matched_member_id: matchedUser?.member_id ?? null,
          matched_user_name: matchedUser?.name ?? null,
          record_time: recordTime,
          state: Number.isFinite(parsedState) ? Math.trunc(parsedState) : -1,
          raw_payload: this.toJsonPayload(record),
          imported_by: args.actor.id,
          imported_by_name: args.actor.name,
        };
      })
      .filter((record): record is AttendancePunch => Boolean(record))
      .sort((left, right) => left.record_time.getTime() - right.record_time.getTime());
  }

  private buildPunchUniqueKey(punch: {
    event_mgt_id: number;
    device_ip: string;
    device_user_id: string;
    record_time: Date;
    state: number;
  }) {
    return [
      punch.event_mgt_id,
      punch.device_ip,
      punch.device_user_id,
      punch.record_time.toISOString(),
      punch.state,
    ].join(":");
  }

  private mergePunchRecords(
    current: AttendancePunch,
    next: AttendancePunch,
  ): AttendancePunch {
    const preferred =
      current.matched_user_id && !next.matched_user_id
        ? current
        : next.matched_user_id && !current.matched_user_id
        ? next
        : current;
    const fallback = preferred === current ? next : current;

    return {
      ...preferred,
      device_user_name: preferred.device_user_name || fallback.device_user_name,
      matched_member_id: preferred.matched_member_id || fallback.matched_member_id,
      matched_user_name: preferred.matched_user_name || fallback.matched_user_name,
    };
  }

  private dedupePunches(punches: AttendancePunch[]) {
    const punchesByKey = new Map<string, AttendancePunch>();
    let duplicateCount = 0;

    for (const punch of punches) {
      const key = this.buildPunchUniqueKey(punch);
      const existing = punchesByKey.get(key);
      if (!existing) {
        punchesByKey.set(key, punch);
        continue;
      }

      duplicateCount += 1;
      punchesByKey.set(key, this.mergePunchRecords(existing, punch));
    }

    return {
      punches: Array.from(punchesByKey.values()).sort(
        (left, right) => left.record_time.getTime() - right.record_time.getTime(),
      ),
      duplicateCount,
    };
  }

  private async persistPunches(
    punches: AttendancePunch[],
    reportProgress?: ImportProgressReporter,
  ) {
    const createResult = await prisma.event_biometric_punch.createMany({
      data: punches,
      skipDuplicates: true,
    });

    const matchedPunches = punches.filter((punch) => punch.matched_user_id);
    const reportEvery = Math.max(1, Math.ceil(matchedPunches.length / 5));
    let upgradedMatchCount = 0;

    for (let index = 0; index < matchedPunches.length; index += 1) {
      const punch = matchedPunches[index];

      const updateResult = await prisma.event_biometric_punch.updateMany({
        where: {
          event_mgt_id: punch.event_mgt_id,
          device_ip: punch.device_ip,
          device_user_id: punch.device_user_id,
          record_time: punch.record_time,
          state: punch.state,
          matched_user_id: null,
        },
        data: {
          matched_user_id: punch.matched_user_id,
          matched_member_id: punch.matched_member_id,
          matched_user_name: punch.matched_user_name,
          device_user_name: punch.device_user_name,
          raw_payload: punch.raw_payload,
          imported_by: punch.imported_by,
          imported_by_name: punch.imported_by_name,
        },
      });

      upgradedMatchCount += updateResult.count;

      if (
        reportProgress &&
        ((index + 1) % reportEvery === 0 || index === matchedPunches.length - 1)
      ) {
        await reportProgress({
          percentage: 65 + Math.round(((index + 1) / matchedPunches.length) * 15),
          step: "Reconciling matched punches",
          patch: {
            punches_staged_new: createResult.count,
            punches_reconciled_to_users: upgradedMatchCount,
          },
        });
      }
    }

    return {
      createdCount: createResult.count,
      upgradedMatchCount,
    };
  }

  private buildAttendanceCandidates(
    punches: Array<{
      matched_user_id: number | null;
      record_time: Date;
      state: number;
    }>,
  ): AttendanceCandidate[] {
    const groupedByUserDay = new Map<string, Array<{ record_time: Date; state: number }>>();

    for (const punch of punches) {
      const userId = this.toPositiveInt(punch.matched_user_id);
      if (!userId) continue;

      const dayKey = this.toUtcDayKey(punch.record_time);
      const groupKey = `${userId}:${dayKey}`;
      const existing = groupedByUserDay.get(groupKey) || [];
      existing.push({
        record_time: punch.record_time,
        state: punch.state,
      });
      groupedByUserDay.set(groupKey, existing);
    }

    const candidates: AttendanceCandidate[] = [];
    for (const [groupKey, groupedPunches] of groupedByUserDay.entries()) {
      const [userIdText, dayKey] = groupKey.split(":");
      const userId = Number(userIdText);
      const checkIns = groupedPunches.filter((punch) => punch.state === 0);
      const sourcePunches = checkIns.length ? checkIns : groupedPunches;
      const earliestPunch = sourcePunches.reduce((current, next) =>
        next.record_time.getTime() < current.record_time.getTime() ? next : current,
      );

      candidates.push({
        user_id: userId,
        created_at: earliestPunch.record_time,
        day_key: dayKey,
      });
    }

    return candidates.sort(
      (left, right) => left.created_at.getTime() - right.created_at.getTime(),
    );
  }

  private getUtcDayBounds(dayKey: string) {
    const start = new Date(`${dayKey}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return { start, end };
  }

  private async persistAttendanceRows(args: {
    eventId: number;
    candidates: AttendanceCandidate[];
    dryRun: boolean;
  }) {
    if (!args.candidates.length) {
      return {
        createdCount: 0,
        existingCount: 0,
      };
    }

    const userIds = Array.from(
      new Set(args.candidates.map((candidate) => candidate.user_id)),
    );
    const dayBounds = args.candidates.map((candidate) =>
      this.getUtcDayBounds(candidate.day_key),
    );
    const minStart = dayBounds.reduce((current, bounds) => {
      return bounds.start.getTime() < current.getTime() ? bounds.start : current;
    }, dayBounds[0].start);
    const maxEnd = dayBounds.reduce((current, bounds) => {
      return bounds.end.getTime() > current.getTime() ? bounds.end : current;
    }, dayBounds[0].end);

    const existingRows = await prisma.event_attendance.findMany({
      where: {
        event_id: args.eventId,
        user_id: {
          in: userIds,
        },
        created_at: {
          gte: minStart,
          lt: maxEnd,
        },
      },
      select: {
        user_id: true,
        created_at: true,
      },
    });

    const existingKeys = new Set(
      existingRows.map(
        (row) => `${row.user_id}:${this.toUtcDayKey(row.created_at)}`,
      ),
    );
    const rowsToCreate = args.candidates.filter((candidate) => {
      const key = `${candidate.user_id}:${candidate.day_key}`;
      return !existingKeys.has(key);
    });

    if (!args.dryRun && rowsToCreate.length > 0) {
      await prisma.event_attendance.createMany({
        data: rowsToCreate.map((candidate) => ({
          event_id: args.eventId,
          user_id: candidate.user_id,
          created_at: candidate.created_at,
        })),
      });
    }

    return {
      createdCount: rowsToCreate.length,
      existingCount: args.candidates.length - rowsToCreate.length,
    };
  }

  private buildUnmatchedSummary(
    punches: Array<{
      device_user_id: string;
      device_user_name: string | null;
      device_ip: string;
      matched_user_id: number | null;
    }>,
  ): MatchSummaryRow[] {
    const grouped = new Map<string, MatchSummaryRow>();

    for (const punch of punches) {
      if (this.toPositiveInt(punch.matched_user_id)) {
        continue;
      }

      const key = `${punch.device_user_id}:${punch.device_user_name ?? ""}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          device_user_id: punch.device_user_id,
          device_user_name: punch.device_user_name,
          punch_count: 1,
          device_ips: [punch.device_ip],
        });
        continue;
      }

      existing.punch_count += 1;
      if (!existing.device_ips.includes(punch.device_ip)) {
        existing.device_ips.push(punch.device_ip);
      }
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.punch_count - left.punch_count)
      .slice(0, 25);
  }
}
