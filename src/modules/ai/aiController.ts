import crypto from "crypto";
import { Request, Response } from "express";
import { prisma } from "../../Models/context";
import { AiProviderError, AiService } from "./aiService";
import { AiQuotaExceededError, AiUsageService } from "./aiUsageService";
import { AiCredentialService, AiCredentialServiceError } from "./aiCredentialService";
import {
  AiChatHistoryMessage,
  AiContext,
  AiReservation,
  AiUsage,
  AiUsageSnapshot,
} from "./aiTypes";

type ChatExecutionResult = {
  conversation_id: string;
  message_id: string;
  reply: string;
  created_at: string;
  usage: AiUsage;
  usage_snapshot: AiUsageSnapshot;
  provider: string;
  model: string;
  fallback_used: boolean;
  fallback_reason?: string;
};

export class AiController {
  private aiService = new AiService();
  private usageService = new AiUsageService();
  private credentialService = new AiCredentialService();

  async listCredentials(req: Request, res: Response) {
    const provider =
      typeof req.query?.provider === "string" ? req.query.provider : undefined;

    try {
      const data = await this.credentialService.listCredentials(provider);
      return res.status(200).json({ data });
    } catch (error: any) {
      if (error instanceof AiCredentialServiceError) {
        return res.status(error.status_code).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Failed to fetch AI credentials",
        data: null,
      });
    }
  }

  async createCredential(req: Request, res: Response) {
    const actorId = this.getActorId(req);
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized. Token not found", data: null });
    }

    try {
      const data = await this.credentialService.createCredential(actorId, {
        provider: req.body?.provider,
        api_key: req.body?.api_key,
        api_secret: req.body?.api_secret,
        is_active: req.body?.is_active,
      });

      await prisma.ai_audit_log.create({
        data: {
          actor_id: actorId,
          action: "ai_credential_create",
          resource: "/ai/credentials",
          metadata: JSON.stringify({
            credential_id: data.id,
            provider: data.provider,
            is_active: data.is_active,
          }),
        },
      });

      return res.status(201).json({ data });
    } catch (error: any) {
      if (error instanceof AiCredentialServiceError) {
        return res.status(error.status_code).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Failed to create AI credential",
        data: null,
      });
    }
  }

  async updateCredential(req: Request, res: Response) {
    const actorId = this.getActorId(req);
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized. Token not found", data: null });
    }

    const credentialId =
      typeof req.params?.id === "string" ? req.params.id.trim() : "";

    try {
      const data = await this.credentialService.updateCredential(credentialId, {
        api_key: req.body?.api_key,
        api_secret: req.body?.api_secret,
        is_active: req.body?.is_active,
      });

      await prisma.ai_audit_log.create({
        data: {
          actor_id: actorId,
          action: "ai_credential_update",
          resource: `/ai/credentials/${credentialId}`,
          metadata: JSON.stringify({
            credential_id: data.id,
            provider: data.provider,
            is_active: data.is_active,
          }),
        },
      });

      return res.status(200).json({ data });
    } catch (error: any) {
      if (error instanceof AiCredentialServiceError) {
        return res.status(error.status_code).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Failed to update AI credential",
        data: null,
      });
    }
  }

  async chat(req: Request, res: Response) {
    const actorId = this.getActorId(req);
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized. Token not found", data: null });
    }

    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const conversationId =
      typeof req.body?.conversation_id === "string"
        ? req.body.conversation_id.trim()
        : undefined;
    const context = this.parseContext(req.body?.context);
    const requestedModelValidation = this.parseRequestedModel(req.body?.model);
    if (!requestedModelValidation.ok) {
      return res.status(400).json({
        message: requestedModelValidation.error,
        data: null,
      });
    }
    const requestedModel = requestedModelValidation.model;

    if (!message) {
      return res.status(400).json({
        message: "message is required",
        data: null,
      });
    }

    const idempotencyKey = this.getIdempotencyKey(req);
    const endpoint = "/ai/chat";
    const requestHash = this.createRequestHash({
      actor_id: actorId,
      message,
      conversation_id: conversationId || null,
      context,
      model: requestedModel || null,
    });

    if (idempotencyKey) {
      const existing = await prisma.ai_idempotency_key.findUnique({
        where: {
          actor_id_endpoint_key: {
            actor_id: actorId,
            endpoint,
            key: idempotencyKey,
          },
        },
      });

      if (existing) {
        if (existing.request_hash !== requestHash) {
          return res.status(409).json({
            message:
              "Idempotency-Key already used with a different request payload",
            data: null,
          });
        }

        const replayPayload = this.parseResponsePayload(existing.response_payload);
        if (replayPayload) {
          return res.status(existing.status_code).json(replayPayload);
        }
      }
    }

    try {
      const result = await this.executeChat({
        actorId,
        message,
        context,
        conversationId,
        requestedModel,
        auditResource: endpoint,
      });

      const payload = {
        data: {
          conversation_id: result.conversation_id,
          message_id: result.message_id,
          reply: result.reply,
          created_at: result.created_at,
          provider: result.provider,
          model: result.model,
          fallback_used: result.fallback_used,
          fallback_reason: result.fallback_reason,
          usage: result.usage,
          usage_snapshot: result.usage_snapshot,
        },
      };

      if (idempotencyKey) {
        await this.storeIdempotencyResult({
          actorId,
          endpoint,
          key: idempotencyKey,
          requestHash,
          statusCode: 200,
          payload,
        });
      }

      return res.status(200).json(payload);
    } catch (error: any) {
      if (error instanceof AiQuotaExceededError) {
        return res.status(429).json({
          message: error.message,
          data: {
            usage_snapshot: error.snapshot,
            reset_at: error.reset_at,
          },
        });
      }

      if (error instanceof Error && error.message === "Conversation not found") {
        return res.status(404).json({
          message: error.message,
          data: null,
        });
      }

      if (
        error instanceof Error &&
        error.message === "Not authorized to access this conversation"
      ) {
        return res.status(401).json({
          message: error.message,
          data: null,
        });
      }

      if (error instanceof AiProviderError) {
        const providerStatus =
          error.status_code >= 500 || error.status_code === 429
            ? 503
            : error.status_code;
        return res.status(providerStatus).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Something went wrong",
        data: null,
      });
    }
  }

  async usageSummary(req: Request, res: Response) {
    try {
      const data = await this.usageService.getUsageSummary();
      return res.status(200).json({ data });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch usage summary",
        data: null,
      });
    }
  }

  async usageHistory(req: Request, res: Response) {
    const interval =
      typeof req.query?.interval === "string" ? req.query.interval : "day";
    if (interval !== "day") {
      return res.status(400).json({
        message: "Only interval=day is currently supported",
        data: null,
      });
    }

    const fromParam = typeof req.query?.from === "string" ? req.query.from : "";
    const toParam = typeof req.query?.to === "string" ? req.query.to : "";

    const from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : this.startOfCurrentMonth();
    const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({
        message: "Invalid from/to date range",
        data: null,
      });
    }

    try {
      const points = await this.usageService.getUsageHistory(from, to);
      return res.status(200).json({
        data: {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          interval: "day",
          points,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch usage history",
        data: null,
      });
    }
  }

  async insights(req: Request, res: Response) {
    const actorId = this.getActorId(req);
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized. Token not found", data: null });
    }

    const moduleName =
      typeof req.params?.module === "string" ? req.params.module.trim() : "";
    if (!moduleName) {
      return res.status(400).json({
        message: "module is required",
        data: null,
      });
    }

    const userPrompt =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const context = this.parseContext(req.body?.context);
    const requestedModelValidation = this.parseRequestedModel(req.body?.model);
    if (!requestedModelValidation.ok) {
      return res.status(400).json({
        message: requestedModelValidation.error,
        data: null,
      });
    }
    const requestedModel = requestedModelValidation.model;
    const basePrompt = [
      `Generate deterministic operational insights for module "${moduleName}".`,
      "Prioritize concise risk flags, trends, and practical next steps.",
      userPrompt || "No additional user prompt provided.",
    ].join(" ");

    try {
      const result = await this.executeChat({
        actorId,
        message: basePrompt,
        context: {
          ...context,
          module: moduleName,
          scope: context.scope || "admin",
        },
        requestedModel,
        conversationTitle: `${moduleName} insights`,
        auditResource: `/ai/insights/${moduleName}`,
      });

      return res.status(200).json({
        data: {
          module: moduleName,
          conversation_id: result.conversation_id,
          message_id: result.message_id,
          reply: result.reply,
          created_at: result.created_at,
          provider: result.provider,
          model: result.model,
          fallback_used: result.fallback_used,
          fallback_reason: result.fallback_reason,
          usage: result.usage,
          usage_snapshot: result.usage_snapshot,
        },
      });
    } catch (error: any) {
      if (error instanceof AiQuotaExceededError) {
        return res.status(429).json({
          message: error.message,
          data: {
            usage_snapshot: error.snapshot,
            reset_at: error.reset_at,
          },
        });
      }

      if (error instanceof Error && error.message === "Conversation not found") {
        return res.status(404).json({
          message: error.message,
          data: null,
        });
      }

      if (
        error instanceof Error &&
        error.message === "Not authorized to access this conversation"
      ) {
        return res.status(401).json({
          message: error.message,
          data: null,
        });
      }

      if (error instanceof AiProviderError) {
        const providerStatus =
          error.status_code >= 500 || error.status_code === 429
            ? 503
            : error.status_code;
        return res.status(providerStatus).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Something went wrong",
        data: null,
      });
    }
  }

  private async executeChat(params: {
    actorId: number;
    message: string;
    context: AiContext;
    conversationId?: string;
    requestedModel?: string;
    conversationTitle?: string;
    auditResource: string;
  }): Promise<ChatExecutionResult> {
    let reservation: AiReservation | null = null;
    try {
      reservation = await this.usageService.reserveQuota();
      const conversation = await this.resolveConversation({
        actorId: params.actorId,
        conversationId: params.conversationId,
        fallbackTitle:
          params.conversationTitle || this.createConversationTitle(params.message),
      });
      const history = await this.getConversationHistory(
        conversation.id,
        this.getChatHistoryLimit(),
      );

      await prisma.ai_message.create({
        data: {
          conversation_id: conversation.id,
          role: "user",
          content: params.message,
          model: params.requestedModel || null,
        },
      });

      const providerResult = await this.aiService.generateReply(
        params.message,
        params.context,
        history,
        {
          model: params.requestedModel,
        },
      );

      const assistantMessage = await prisma.ai_message.create({
        data: {
          conversation_id: conversation.id,
          role: "assistant",
          content: providerResult.reply,
          provider: providerResult.provider,
          model: providerResult.model,
        },
      });

      const usageSnapshot = await this.usageService.commitUsage({
        conversation_id: conversation.id,
        message_id: assistantMessage.id,
        provider: providerResult.provider,
        model: providerResult.model,
        prompt_tokens: providerResult.usage.prompt_tokens,
        completion_tokens: providerResult.usage.completion_tokens,
        total_tokens: providerResult.usage.total_tokens,
      });

      await prisma.ai_audit_log.create({
        data: {
          actor_id: params.actorId,
          action: "ai_chat_completion",
          resource: params.auditResource,
          metadata: JSON.stringify({
            conversation_id: conversation.id,
            message_id: assistantMessage.id,
            provider: providerResult.provider,
            model: providerResult.model,
            requested_model: params.requestedModel || null,
            usage: providerResult.usage,
            fallback_used: providerResult.fallback_used,
            fallback_reason: providerResult.fallback_reason,
          }),
        },
      });

      return {
        conversation_id: conversation.id,
        message_id: assistantMessage.id,
        reply: providerResult.reply,
        created_at: assistantMessage.created_at.toISOString(),
        usage: providerResult.usage,
        usage_snapshot: usageSnapshot,
        provider: providerResult.provider,
        model: providerResult.model,
        fallback_used: providerResult.fallback_used,
        fallback_reason: providerResult.fallback_reason,
      };
    } finally {
      if (reservation) {
        this.usageService.releaseReservation(reservation);
      }
    }
  }

  private async resolveConversation(params: {
    actorId: number;
    conversationId?: string;
    fallbackTitle: string;
  }) {
    if (params.conversationId) {
      const existingConversation = await prisma.ai_conversation.findUnique({
        where: { id: params.conversationId },
      });
      if (!existingConversation) {
        throw new Error("Conversation not found");
      }
      if (existingConversation.created_by !== params.actorId) {
        throw new Error("Not authorized to access this conversation");
      }
      return existingConversation;
    }

    return prisma.ai_conversation.create({
      data: {
        created_by: params.actorId,
        title: params.fallbackTitle,
      },
    });
  }

  private createConversationTitle(message: string): string {
    return message.length > 80 ? `${message.slice(0, 77)}...` : message;
  }

  private parseContext(context: unknown): AiContext {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      return {};
    }
    return context as AiContext;
  }

  private getActorId(req: Request): number | null {
    const rawId = (req as any)?.user?.id;
    const parsed = Number(rawId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private getIdempotencyKey(req: Request): string | null {
    const headerValue = req.headers["idempotency-key"];
    if (typeof headerValue === "string" && headerValue.trim()) {
      return headerValue.trim();
    }
    if (Array.isArray(headerValue) && headerValue.length > 0) {
      const first = String(headerValue[0] || "").trim();
      return first || null;
    }
    return null;
  }

  private createRequestHash(payload: Record<string, unknown>): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
  }

  private parseResponsePayload(payload: string | null): Record<string, unknown> | null {
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async storeIdempotencyResult(params: {
    actorId: number;
    endpoint: string;
    key: string;
    requestHash: string;
    statusCode: number;
    payload: Record<string, unknown>;
  }) {
    try {
      await prisma.ai_idempotency_key.create({
        data: {
          actor_id: params.actorId,
          endpoint: params.endpoint,
          key: params.key,
          request_hash: params.requestHash,
          status_code: params.statusCode,
          response_payload: JSON.stringify(params.payload),
        },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") {
        throw error;
      }
    }
  }

  private startOfCurrentMonth(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private async getConversationHistory(
    conversationId: string,
    limit: number,
  ): Promise<AiChatHistoryMessage[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    const rows = await prisma.ai_message.findMany({
      where: {
        conversation_id: conversationId,
        role: {
          in: ["user", "assistant"],
        },
      },
      orderBy: {
        created_at: "desc",
      },
      take: limit,
      select: {
        role: true,
        content: true,
      },
    });

    return rows
      .reverse()
      .map((row) => ({
        role: row.role === "assistant" ? "assistant" : "user",
        content: row.content,
      }));
  }

  private getChatHistoryLimit(): number {
    const parsed = Number(process.env.AI_CHAT_HISTORY_LIMIT);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 12;
  }

  private parseRequestedModel(value: unknown):
    | { ok: true; model?: string }
    | { ok: false; error: string } {
    if (value === undefined || value === null) {
      return { ok: false, error: "model is required" };
    }

    if (typeof value !== "string") {
      return { ok: false, error: "model must be a string" };
    }

    const model = value.trim();
    if (!model) {
      return { ok: false, error: "model cannot be empty" };
    }

    if (model.length > 100) {
      return { ok: false, error: "model is too long" };
    }

    return { ok: true, model };
  }
}
