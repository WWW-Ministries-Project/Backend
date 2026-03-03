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

export const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: prismaTransactionMaxWaitMs,
    timeout: prismaTransactionTimeoutMs,
  },
});
