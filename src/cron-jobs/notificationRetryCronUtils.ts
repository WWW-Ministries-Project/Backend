import { Prisma } from "@prisma/client";

const DATABASE_UNAVAILABLE_PATTERNS = [
  /can't reach database server/i,
  /\bp1001\b/i,
  /econnrefused/i,
  /etimedout/i,
  /server has closed the connection/i,
  /connection.*timed out/i,
];

const DATABASE_ERROR_LOG_INTERVAL_MS = 5 * 60 * 1000;
const lastDatabaseWarningAtByJob = new Map<string, number>();

export const normalizeCronJobErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return String(error || "Unknown error");
};

export const isDatabaseUnavailableError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return DATABASE_UNAVAILABLE_PATTERNS.some((pattern) =>
      pattern.test(normalizeCronJobErrorMessage(error)),
    );
  }

  return DATABASE_UNAVAILABLE_PATTERNS.some((pattern) =>
    pattern.test(normalizeCronJobErrorMessage(error)),
  );
};

export const logDatabaseUnavailableWarning = (
  jobLabel: string,
  errorMessage: string,
) => {
  const now = Date.now();
  const lastLoggedAt = lastDatabaseWarningAtByJob.get(jobLabel) || 0;

  if (now - lastLoggedAt < DATABASE_ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastDatabaseWarningAtByJob.set(jobLabel, now);
  console.warn(`[WARN] ${jobLabel} skipped: database unavailable: ${errorMessage}`);
};
