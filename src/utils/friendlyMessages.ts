type FriendlyMessageOptions = {
  isError?: boolean;
  statusCode?: number;
};

const EXACT_REPLACEMENTS: Record<string, string> = {
  "operation sucessful": "Request completed successfully.",
  "operation sucessfull": "Request completed successfully.",
  "operation successful": "Request completed successfully.",
  "operation failed": "We could not complete your request right now.",
  "something went wrong":
    "Something went wrong on our side.",
  "session expired":
    "Your session has expired. Please sign in again to continue.",
  "not authorized. token not found":
    "You are not signed in. Please sign in and try again.",
  unauthorized: "You are not authorized to perform this action.",
};

const COMMON_TYPO_FIXES: Array<[RegExp, string]> = [
  [/\b[Ss]uccesful\b/g, "successful"],
  [/\b[Ss]ucessful\b/g, "successful"],
  [/\b[Ss]uccesfull\b/g, "successful"],
  [/\b[Ss]ucessfull\b/g, "successful"],
  [/\b[Ss]uccesfully\b/g, "successfully"],
  [/\b[Ss]ucessfully\b/g, "successfully"],
  [/\btopicc\b/gi, "topic"],
];

const withPeriod = (message: string): string => {
  return /[.!?]$/.test(message) ? message : `${message}.`;
};

const capitalizeFirst = (message: string): string => {
  if (!message.length) return message;
  return message.charAt(0).toUpperCase() + message.slice(1);
};

const normalizeWhitespace = (message: string): string => {
  return message.trim().replace(/\s+/g, " ");
};

const getErrorGuidance = (statusCode?: number): string => {
  if (!statusCode) return "";

  if ([408, 429, 500, 502, 503, 504].includes(statusCode)) {
    return " Please try again in a moment.";
  }

  if (statusCode === 400 || statusCode === 422) {
    return " Please check the details and try again.";
  }

  if (statusCode === 401) {
    return " Please sign in and try again.";
  }

  if (statusCode === 403) {
    return " If you believe this is a mistake, please contact support.";
  }

  if (statusCode === 409) {
    return " Please refresh and choose another option.";
  }

  return "";
};

const toFriendlyFromPattern = (
  message: string,
  options: FriendlyMessageOptions = {},
): string | null => {
  const guidance = options.isError ? getErrorGuidance(options.statusCode) : "";

  const notAuthorizedMatch = message.match(/^not authorized to (.+)\.?$/i);
  if (notAuthorizedMatch?.[1]) {
    return withPeriod(`You do not have permission to ${notAuthorizedMatch[1]}`);
  }

  const notFoundMatch = message.match(/^(.+?) not found\.?$/i);
  if (notFoundMatch?.[1]) {
    return withPeriod(
      `We could not find the requested ${notFoundMatch[1].toLowerCase()}`,
    );
  }

  const noFoundMatch = message.match(
    /^no (.+?) found(?: for this (.+))?\.?$/i,
  );
  if (noFoundMatch?.[1]) {
    const context = noFoundMatch[2]
      ? ` for the selected ${noFoundMatch[2].toLowerCase()}`
      : "";
    return withPeriod(
      `We could not find any ${noFoundMatch[1].toLowerCase()}${context}`,
    );
  }

  const invalidMatch = message.match(/^invalid (.+)\.?$/i);
  if (invalidMatch?.[1]) {
    return withPeriod(
      `The provided ${invalidMatch[1]} is invalid. Please check and try again`,
    );
  }

  const requiredMatch = message.match(/^(.+?) is required(?: in query)?\.?$/i);
  if (requiredMatch?.[1]) {
    return withPeriod(`Please provide ${requiredMatch[1]} to continue`);
  }

  const mustBeMatch = message.match(/^(.+?) must be (.+)\.?$/i);
  if (mustBeMatch?.[1] && mustBeMatch?.[2]) {
    return withPeriod(
      `${capitalizeFirst(
        mustBeMatch[1],
      )} must be ${mustBeMatch[2].toLowerCase()}. Please check and try again`,
    );
  }

  const createMatch = message.match(/^error creating (.+)\.?$/i);
  if (createMatch?.[1]) {
    return withPeriod(
      `We could not create ${createMatch[1].toLowerCase()} right now.${guidance}`,
    );
  }

  const fetchMatch = message.match(/^error fetching (.+)\.?$/i);
  if (fetchMatch?.[1]) {
    return withPeriod(
      `We could not load ${fetchMatch[1].toLowerCase()} right now.${guidance}`,
    );
  }

  const updateMatch = message.match(/^error updating (.+)\.?$/i);
  if (updateMatch?.[1]) {
    return withPeriod(
      `We could not update ${updateMatch[1].toLowerCase()} right now.${guidance}`,
    );
  }

  const deleteMatch = message.match(/^error deleting (.+)\.?$/i);
  if (deleteMatch?.[1]) {
    return withPeriod(
      `We could not delete ${deleteMatch[1].toLowerCase()} right now.${guidance}`,
    );
  }

  const failedMatch = message.match(/^failed to (.+)\.?$/i);
  if (failedMatch?.[1]) {
    return withPeriod(
      `We could not ${failedMatch[1].toLowerCase()} right now.${guidance}`,
    );
  }

  return null;
};

export const toUserFriendlyMessage = (
  rawMessage: string,
  options: FriendlyMessageOptions = {},
): string => {
  if (!rawMessage || typeof rawMessage !== "string") {
    return rawMessage;
  }

  let message = normalizeWhitespace(rawMessage);

  for (const [pattern, replacement] of COMMON_TYPO_FIXES) {
    message = message.replace(pattern, replacement);
  }

  const normalizedKey = message.toLowerCase().replace(/[.!?]+$/, "");
  const exactReplacement = EXACT_REPLACEMENTS[normalizedKey];
  if (exactReplacement) {
    const guidance =
      options.isError && options.statusCode
        ? getErrorGuidance(options.statusCode)
        : "";
    if (guidance && !/please\s/i.test(exactReplacement)) {
      return withPeriod(`${exactReplacement}${guidance}`);
    }
    return withPeriod(exactReplacement);
  }

  const patternReplacement = toFriendlyFromPattern(message, options);
  if (patternReplacement) {
    return patternReplacement;
  }

  if (options.isError && /^error\b[:\s-]*/i.test(message)) {
    const detail = message.replace(/^error\b[:\s-]*/i, "").trim();
    if (!detail.length) {
      const guidance = getErrorGuidance(options.statusCode);
      return withPeriod(`We ran into an unexpected problem.${guidance}`);
    }

    const guidance = getErrorGuidance(options.statusCode);
    return withPeriod(
      `We ran into a problem while processing your request (${detail.toLowerCase()}).${guidance}`,
    );
  }

  return withPeriod(capitalizeFirst(message));
};
