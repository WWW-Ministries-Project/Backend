import { PrismaClient } from "@prisma/client";

const toPositiveIntOrFallback = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const prismaTransactionMaxWaitMs = toPositiveIntOrFallback(
  process.env.PRISMA_TX_MAX_WAIT_MS,
  10_000,
);
const prismaTransactionTimeoutMs = toPositiveIntOrFallback(
  process.env.PRISMA_TX_TIMEOUT_MS,
  20_000,
);

// Without an explicit connection_limit, Prisma sizes the pool from the host's
// detected CPU count (num_physical_cpus * 2 + 1) and defaults pool_timeout to
// 10s. On a small/CPU-constrained host (e.g. 1 vCPU) that yields a 3-connection
// pool, which saturates under normal request concurrency (every authenticated
// request runs a `user` lookup in the auth middleware) and surfaces as
// PrismaClientKnownRequestError P2024 "Timed out fetching a new connection
// from the pool". Pin both explicitly so pool size doesn't silently shrink
// with the host's CPU count; tune via env without a code change.
const prismaConnectionLimit = toPositiveIntOrFallback(process.env.PRISMA_CONNECTION_LIMIT, 10);
const prismaPoolTimeoutSeconds = toPositiveIntOrFallback(process.env.PRISMA_POOL_TIMEOUT_S, 20);

const buildDatasourceUrl = (): string => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    // Let PrismaClient raise its normal "DATABASE_URL not found" error.
    return rawUrl as unknown as string;
  }

  // Split on the first "?" and only touch the query string. Credentials can
  // contain characters (e.g. an unescaped "%") that round-trip unsafely
  // through `new URL(...).toString()`, so the base "scheme://user:pass@host/db"
  // is left completely untouched.
  const queryIndex = rawUrl.indexOf("?");
  const base = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const existingQuery = queryIndex === -1 ? "" : rawUrl.slice(queryIndex + 1);
  const params = new URLSearchParams(existingQuery);
  if (!params.has("connection_limit")) {
    params.set("connection_limit", String(prismaConnectionLimit));
  }
  if (!params.has("pool_timeout")) {
    params.set("pool_timeout", String(prismaPoolTimeoutSeconds));
  }
  return `${base}?${params.toString()}`;
};

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: buildDatasourceUrl(),
    },
  },
  transactionOptions: {
    maxWait: prismaTransactionMaxWaitMs,
    timeout: prismaTransactionTimeoutMs,
  },
});
