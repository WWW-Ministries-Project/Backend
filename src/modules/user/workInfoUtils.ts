type WorkInfoInput = {
  employment_status?: unknown;
  work_name?: unknown;
  work_industry?: unknown;
  work_position?: unknown;
  school_name?: unknown;
};

type ExistingWorkInfo = {
  employment_status?: string | null;
  name_of_institution?: string | null;
  industry?: string | null;
  position?: string | null;
  school_name?: string | null;
} | null | undefined;

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const normalizeOptionalText = (value: unknown) => {
  if (!hasValue(value)) return null;
  return String(value).trim();
};

const normalizeEmploymentStatusKey = (value: unknown) => {
  const normalizedStatus = normalizeOptionalText(value);
  if (!normalizedStatus) return null;

  return normalizedStatus.replace(/[\s-]+/g, "_").toUpperCase();
};

const workDetailsOptionalStatuses = new Set([
  "STUDENT",
  "UNEMPLOYED",
  "RETIRED",
]);

const getEffectiveEmploymentStatus = (
  input: WorkInfoInput,
  existingWorkInfo?: ExistingWorkInfo,
) =>
  normalizeOptionalText(input.employment_status) ||
  normalizeOptionalText(existingWorkInfo?.employment_status);

export const hasAnyWorkInfoPayload = (input: WorkInfoInput) =>
  hasValue(input.employment_status) ||
  hasValue(input.work_name) ||
  hasValue(input.work_industry) ||
  hasValue(input.work_position) ||
  hasValue(input.school_name);

export const isUnemployedEmploymentStatus = (value: unknown) =>
  normalizeEmploymentStatusKey(value) === "UNEMPLOYED";

export const isWorkDetailsOptionalEmploymentStatus = (value: unknown) =>
  workDetailsOptionalStatuses.has(normalizeEmploymentStatusKey(value) || "");

export const getMissingRequiredWorkFields = (
  input: WorkInfoInput,
  existingWorkInfo?: ExistingWorkInfo,
) => {
  if (!hasAnyWorkInfoPayload(input)) {
    return [];
  }

  const effectiveEmploymentStatus = getEffectiveEmploymentStatus(
    input,
    existingWorkInfo,
  );

  if (isWorkDetailsOptionalEmploymentStatus(effectiveEmploymentStatus)) {
    return [];
  }

  const nextWorkName =
    normalizeOptionalText(input.work_name) ||
    normalizeOptionalText(existingWorkInfo?.name_of_institution);
  const nextIndustry =
    normalizeOptionalText(input.work_industry) ||
    normalizeOptionalText(existingWorkInfo?.industry);
  const nextPosition =
    normalizeOptionalText(input.work_position) ||
    normalizeOptionalText(existingWorkInfo?.position);

  return [
    !nextWorkName ? "work_info.work_name" : null,
    !nextIndustry ? "work_info.work_industry" : null,
    !nextPosition ? "work_info.work_position" : null,
  ].filter((field): field is string => Boolean(field));
};

export const buildPersistedWorkInfoData = (
  input: WorkInfoInput,
  existingWorkInfo?: ExistingWorkInfo,
) => {
  const effectiveEmploymentStatus = getEffectiveEmploymentStatus(
    input,
    existingWorkInfo,
  );
  const shouldClearWorkDetails = isWorkDetailsOptionalEmploymentStatus(
    effectiveEmploymentStatus,
  );

  return {
    employment_status: effectiveEmploymentStatus,
    name_of_institution:
      normalizeOptionalText(input.work_name) ||
      (shouldClearWorkDetails
        ? ""
        : normalizeOptionalText(existingWorkInfo?.name_of_institution) || ""),
    industry:
      normalizeOptionalText(input.work_industry) ||
      (shouldClearWorkDetails
        ? ""
        : normalizeOptionalText(existingWorkInfo?.industry) || ""),
    position:
      normalizeOptionalText(input.work_position) ||
      (shouldClearWorkDetails
        ? ""
        : normalizeOptionalText(existingWorkInfo?.position) || ""),
    school_name:
      normalizeOptionalText(input.school_name) ||
      normalizeOptionalText(existingWorkInfo?.school_name),
  };
};
