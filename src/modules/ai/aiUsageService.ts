import { prisma } from "../../Models/context";
import { AiReservation, AiUsageCommitPayload, AiUsageSnapshot } from "./aiTypes";

type ReservationCounter = {
  messages: number;
  tokens: number;
};

const reservationByPeriod = new Map<string, ReservationCounter>();

const getEnvInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const DEFAULT_MESSAGE_LIMIT = 5000;
const DEFAULT_TOKEN_LIMIT = 5000000;
const DEFAULT_SOFT_RESERVED_TOKENS = 2000;

type QuotaState = {
  id: string;
  period_start: Date;
  period_end: Date;
  message_limit: number;
  token_limit: number;
  message_used: number;
  token_used: number;
  updated_at: Date;
};

export class AiQuotaExceededError extends Error {
  snapshot: AiUsageSnapshot;
  reset_at: string;

  constructor(message: string, snapshot: AiUsageSnapshot, resetAt: Date) {
    super(message);
    this.name = "AiQuotaExceededError";
    this.snapshot = snapshot;
    this.reset_at = resetAt.toISOString();
  }
}

export class AiUsageService {
  async reserveQuota(): Promise<AiReservation> {
    const quota = await this.getOrCreateCurrentQuota();
    const reservationTokens = getEnvInt(
      "AI_SOFT_RESERVED_TOKENS",
      DEFAULT_SOFT_RESERVED_TOKENS,
    );
    const reservationKey = quota.period_start.toISOString();
    const currentReservations = reservationByPeriod.get(reservationKey) || {
      messages: 0,
      tokens: 0,
    };

    const projectedMessages = quota.message_used + currentReservations.messages + 1;
    const projectedTokens = quota.token_used + currentReservations.tokens + reservationTokens;

    if (projectedMessages > quota.message_limit || projectedTokens > quota.token_limit) {
      const snapshot = this.toUsageSnapshot(quota);
      throw new AiQuotaExceededError(
        "AI usage quota exceeded",
        snapshot,
        quota.period_end,
      );
    }

    reservationByPeriod.set(reservationKey, {
      messages: currentReservations.messages + 1,
      tokens: currentReservations.tokens + reservationTokens,
    });

    return {
      period_start: quota.period_start,
      period_end: quota.period_end,
      reserved_messages: 1,
      reserved_tokens: reservationTokens,
    };
  }

  releaseReservation(reservation: AiReservation): void {
    const key = reservation.period_start.toISOString();
    const existing = reservationByPeriod.get(key);
    if (!existing) return;

    const nextMessages = Math.max(0, existing.messages - reservation.reserved_messages);
    const nextTokens = Math.max(0, existing.tokens - reservation.reserved_tokens);

    if (nextMessages === 0 && nextTokens === 0) {
      reservationByPeriod.delete(key);
      return;
    }

    reservationByPeriod.set(key, {
      messages: nextMessages,
      tokens: nextTokens,
    });
  }

  async commitUsage(payload: AiUsageCommitPayload): Promise<AiUsageSnapshot> {
    const quota = await this.getOrCreateCurrentQuota();

    const pricing = await prisma.ai_pricing_catalog.findFirst({
      where: {
        provider: payload.provider,
        model: payload.model,
        effective_from: { lte: new Date() },
      },
      orderBy: {
        effective_from: "desc",
      },
    });

    const inputCostPer1k = pricing
      ? pricing.input_token_cost
      : this.getDefaultInputCostPer1k(payload.provider);
    const outputCostPer1k = pricing
      ? pricing.output_token_cost
      : this.getDefaultOutputCostPer1k(payload.provider);

    const costEstimate =
      (payload.prompt_tokens / 1000) * inputCostPer1k +
      (payload.completion_tokens / 1000) * outputCostPer1k;

    const result = await prisma.$transaction(async (tx) => {
      await tx.ai_usage_ledger.create({
        data: {
          conversation_id: payload.conversation_id,
          message_id: payload.message_id,
          prompt_tokens: payload.prompt_tokens,
          completion_tokens: payload.completion_tokens,
          total_tokens: payload.total_tokens,
          message_count: 1,
          cost_estimate: Number.isFinite(costEstimate) ? costEstimate : 0,
          provider: payload.provider,
          model: payload.model,
        },
      });

      const updatedQuota = await tx.ai_usage_quota.update({
        where: { id: quota.id },
        data: {
          message_used: { increment: 1 },
          token_used: { increment: payload.total_tokens },
        },
      });

      return updatedQuota;
    });

    return this.toUsageSnapshot({
      ...result,
      message_limit: result.message_limit,
      token_limit: result.token_limit,
    });
  }

  async getUsageSummary() {
    const quota = await this.getOrCreateCurrentQuota();
    return {
      period_start: quota.period_start.toISOString(),
      period_end: quota.period_end.toISOString(),
      message_window: "monthly",
      token_window: "monthly",
      message_limit: quota.message_limit,
      message_used: quota.message_used,
      message_remaining: Math.max(0, quota.message_limit - quota.message_used),
      token_limit: quota.token_limit,
      token_used: quota.token_used,
      token_remaining: Math.max(0, quota.token_limit - quota.token_used),
      updated_at: quota.updated_at.toISOString(),
    };
  }

  async getUsageHistory(from: Date, to: Date) {
    const ledger = await prisma.ai_usage_ledger.findMany({
      where: {
        created_at: {
          gte: from,
          lte: to,
        },
      },
      select: {
        created_at: true,
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        message_count: true,
        cost_estimate: true,
      },
      orderBy: {
        created_at: "asc",
      },
    });

    const map = new Map<
      string,
      {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        message_count: number;
        cost_estimate: number;
      }
    >();

    for (const item of ledger) {
      const key = item.created_at.toISOString().slice(0, 10);
      const existing = map.get(key) || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        message_count: 0,
        cost_estimate: 0,
      };

      map.set(key, {
        prompt_tokens: existing.prompt_tokens + item.prompt_tokens,
        completion_tokens: existing.completion_tokens + item.completion_tokens,
        total_tokens: existing.total_tokens + item.total_tokens,
        message_count: existing.message_count + item.message_count,
        cost_estimate: existing.cost_estimate + Number(item.cost_estimate || 0),
      });
    }

    return Array.from(map.entries()).map(([date, values]) => ({
      date,
      ...values,
    }));
  }

  private async getOrCreateCurrentQuota(): Promise<QuotaState> {
    const { periodStart, periodEnd } = this.getCurrentMonthBounds();
    const existing = await prisma.ai_usage_quota.findFirst({
      where: {
        period_start: periodStart,
        period_end: periodEnd,
      },
    });

    if (existing) {
      return existing;
    }

    try {
      return await prisma.ai_usage_quota.create({
        data: {
          period_start: periodStart,
          period_end: periodEnd,
          message_limit: getEnvInt("AI_MESSAGE_LIMIT_MONTHLY", DEFAULT_MESSAGE_LIMIT),
          token_limit: getEnvInt("AI_TOKEN_LIMIT_MONTHLY", DEFAULT_TOKEN_LIMIT),
        },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") {
        throw error;
      }

      const createdByAnotherRequest = await prisma.ai_usage_quota.findFirst({
        where: {
          period_start: periodStart,
          period_end: periodEnd,
        },
      });
      if (createdByAnotherRequest) {
        return createdByAnotherRequest;
      }
      throw error;
    }
  }

  private getCurrentMonthBounds(): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, -1),
    );

    return { periodStart, periodEnd };
  }

  private getDefaultInputCostPer1k(provider: string): number {
    if (provider === "openai") {
      return this.getEnvFloat("OPENAI_INPUT_TOKEN_COST_PER_1K", 0);
    }
    if (provider === "gemini") {
      return this.getEnvFloat("GEMINI_INPUT_TOKEN_COST_PER_1K", 0);
    }
    return 0;
  }

  private getDefaultOutputCostPer1k(provider: string): number {
    if (provider === "openai") {
      return this.getEnvFloat("OPENAI_OUTPUT_TOKEN_COST_PER_1K", 0);
    }
    if (provider === "gemini") {
      return this.getEnvFloat("GEMINI_OUTPUT_TOKEN_COST_PER_1K", 0);
    }
    return 0;
  }

  private getEnvFloat(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toUsageSnapshot(quota: {
    message_limit: number;
    message_used: number;
    token_limit: number;
    token_used: number;
  }): AiUsageSnapshot {
    return {
      message_limit: quota.message_limit,
      message_used: quota.message_used,
      message_remaining: Math.max(0, quota.message_limit - quota.message_used),
      token_limit: quota.token_limit,
      token_used: quota.token_used,
      token_remaining: Math.max(0, quota.token_limit - quota.token_used),
    };
  }
}
