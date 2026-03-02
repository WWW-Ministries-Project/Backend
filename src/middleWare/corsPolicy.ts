import type { CorsOptions } from "cors";
import logger from "../utils/logger-config";

const stripWrappingQuotes = (value: string): string =>
  value.replace(/^['"]+|['"]+$/g, "").trim();

const splitOrigins = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\n]/)
    .map((entry) => stripWrappingQuotes(entry))
    .filter(Boolean);
};

const normalizeOrigin = (origin: string): string | null => {
  const cleaned = stripWrappingQuotes(origin);
  if (!cleaned) {
    return null;
  }

  if (cleaned === "*") {
    return "*";
  }

  const urlCandidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(cleaned)
    ? cleaned
    : `https://${cleaned}`;

  try {
    return new URL(urlCandidate).origin.toLowerCase();
  } catch {
    return null;
  }
};

const buildAllowedOrigins = (): Set<string> => {
  const origins = new Set<string>();

  for (const rawOrigin of splitOrigins(process.env.CORS_ORIGINS)) {
    const normalized = normalizeOrigin(rawOrigin);
    if (normalized) {
      origins.add(normalized);
    }
  }

  const frontendOrigin = normalizeOrigin(String(process.env.Frontend_URL || ""));
  if (frontendOrigin) {
    origins.add(frontendOrigin);
  }

  return origins;
};

const configuredOrigins = buildAllowedOrigins();
const isProduction =
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const allowAllOrigins =
  !isProduction || configuredOrigins.size === 0 || configuredOrigins.has("*");

if (!isProduction) {
  logger.warn(
    "CORS allowlist checks are paused because NODE_ENV is not production.",
  );
} else if (allowAllOrigins) {
  logger.warn(
    "CORS allowlist is empty (or wildcard enabled). All origins are currently allowed.",
  );
} else {
  logger.info(
    `CORS allowlist enabled for ${configuredOrigins.size} origin(s): ${Array.from(configuredOrigins).join(", ")}`,
  );
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Non-browser clients (curl, internal jobs) may omit the Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowAllOrigins) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && configuredOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    logger.warn(`Blocked CORS request from origin: ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};
