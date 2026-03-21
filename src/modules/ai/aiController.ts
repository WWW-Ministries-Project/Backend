import crypto from "crypto";
import { Request, Response } from "express";
import { prisma } from "../../Models/context";
import { AiProviderError, AiService } from "./aiService";
import { AiQuotaExceededError, AiUsageService } from "./aiUsageService";
import { AiCredentialService, AiCredentialServiceError } from "./aiCredentialService";
import { AiBusinessContextService } from "./aiBusinessContextService";
import { AiReadOnlyDataService, AiReadOnlyDataServiceError } from "./aiReadOnlyDataService";
import { AiResponseFormatter } from "./aiResponseFormatter";
import {
  AiChatHistoryMessage,
  AiContext,
  AiDisplay,
  AiReservation,
  AiResponsePerformance,
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
  display: AiDisplay;
  performance: AiResponsePerformance;
};

export class AiController {
  private aiService = new AiService();
  private usageService = new AiUsageService();
  private credentialService = new AiCredentialService();
  private businessContextService = new AiBusinessContextService();
  private readOnlyDataService = new AiReadOnlyDataService();
  private responseFormatter = new AiResponseFormatter();

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

  async chatbotConfig(req: Request, res: Response) {
    if (!this.getAdminActorId(req, res)) {
      return;
    }

    try {
      const availableModels =
        await this.credentialService.listAvailableChatbotModels();
      const defaultModel = availableModels[0] ?? null;
      const enabled = Boolean(defaultModel);

      return res.status(200).json({
        data: {
          enabled,
          default_model: defaultModel?.model ?? null,
          provider: defaultModel?.provider ?? null,
          available_models: availableModels,
          default_context: {
            module: "operations",
            scope: "admin",
          },
          welcome_message: enabled
            ? "Ask for operational summaries, data lookups, risk flags, and follow-up guidance."
            : "AI chatbot is unavailable until an active provider credential is configured.",
          suggested_prompts: enabled
            ? [
                "Summarize urgent operational issues today.",
                "Show pending approvals and likely bottlenecks.",
                "Which visitors or members need follow-up right now?",
              ]
            : [
                "Open AI Console and activate an OpenAI, Gemini, or Claude credential.",
              ],
          unavailable_reason: enabled
            ? null
            : "Configure and activate an AI provider credential in AI Console to enable the chatbot.",
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to load AI chatbot configuration",
        data: null,
      });
    }
  }

  async chatbot(req: Request, res: Response) {
    const actorId = this.getAdminActorId(req, res);
    if (!actorId) {
      return;
    }

    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const conversationId =
      typeof req.body?.conversation_id === "string"
        ? req.body.conversation_id.trim()
        : undefined;
    const parsedContext = this.parseContext(req.body?.context);
    const context = {
      ...parsedContext,
      module:
        typeof parsedContext.module === "string" && parsedContext.module.trim()
          ? parsedContext.module.trim()
          : "operations",
      scope: "admin",
      chat_surface: "chatbot_widget",
    };

    const requestedModelValidation =
      req.body?.model === undefined || req.body?.model === null
        ? { ok: true as const, model: undefined }
        : this.parseRequestedModel(req.body?.model);

    if (!requestedModelValidation.ok) {
      return res.status(400).json({
        message: requestedModelValidation.error,
        data: null,
      });
    }

    if (!message) {
      return res.status(400).json({
        message: "message is required",
        data: null,
      });
    }

    const resolvedModel =
      requestedModelValidation.model ||
      (await this.credentialService.resolveDefaultChatbotModel())?.model;

    if (!resolvedModel) {
      return res.status(503).json({
        message:
          "AI chatbot is unavailable until an active provider credential is configured",
        data: null,
      });
    }

    const idempotencyKey = this.getIdempotencyKey(req);
    const endpoint = "/ai/chatbot";
    const requestHash = this.createRequestHash({
      actor_id: actorId,
      message,
      conversation_id: conversationId || null,
      context,
      model: requestedModelValidation.model || null,
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
        requestedModel: resolvedModel,
        auditResource: endpoint,
      });

      const payload = {
        data: this.buildChatResponseData(result),
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
        data: this.buildChatResponseData(result),
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

  async queryContracts(req: Request, res: Response) {
    const moduleName =
      typeof req.query?.module === "string" ? req.query.module.trim() : undefined;

    try {
      const data = this.readOnlyDataService.listContracts(moduleName);
      return res.status(200).json({ data });
    } catch (error: any) {
      if (error instanceof AiReadOnlyDataServiceError) {
        return res.status(error.status_code).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Failed to fetch read-only query contracts",
        data: null,
      });
    }
  }

  async queryReadOnly(req: Request, res: Response) {
    const actorId = this.getActorId(req);
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized. Token not found", data: null });
    }

    const moduleName =
      typeof req.body?.module === "string"
        ? req.body.module.trim()
        : typeof req.query?.module === "string"
          ? req.query.module.trim()
          : "";
    const operation =
      typeof req.body?.operation === "string"
        ? req.body.operation.trim()
        : typeof req.query?.operation === "string"
          ? req.query.operation.trim()
          : "";
    const input =
      req.body?.input && typeof req.body.input === "object" && !Array.isArray(req.body.input)
        ? (req.body.input as Record<string, unknown>)
        : {};
    const crossModule = true;

    if (!moduleName || !operation) {
      return res.status(400).json({
        message: "module and operation are required",
        data: null,
      });
    }

    try {
      const data = await this.readOnlyDataService.executeQuery({
        module: moduleName,
        operation,
        input,
        actorId,
        crossModule,
      });

      await prisma.ai_audit_log.create({
        data: {
          actor_id: actorId,
          action: "ai_read_only_query",
          resource: "/ai/query-read-only",
          metadata: JSON.stringify({
            module: data.module,
            operation: data.operation,
            applied_filters: data.applied_filters,
          }),
        },
      });

      return res.status(200).json({ data });
    } catch (error: any) {
      if (error instanceof AiReadOnlyDataServiceError) {
        return res.status(error.status_code).json({
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        message: "Failed to execute read-only query",
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
    const normalizedModule = moduleName.toLowerCase();
    const isOperationsModule = normalizedModule === "operations";
    const basePrompt = [
      `Generate deterministic operational insights for module "${moduleName}".`,
      isOperationsModule
        ? "Because module is operations, you are allowed to answer across all backend modules."
        : `Focus primarily on ${moduleName} while still using relevant cross-module dependencies when needed.`,
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
          cross_module_access: isOperationsModule,
        },
        requestedModel,
        conversationTitle: `${moduleName} insights`,
        auditResource: `/ai/insights/${moduleName}`,
      });

      return res.status(200).json({
        data: {
          module: moduleName,
          ...this.buildChatResponseData(result),
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
    const startedAt = Date.now();
    try {
      reservation = await this.usageService.reserveQuota();
      const conversationParams = {
        actorId: params.actorId,
        conversationId: params.conversationId,
        fallbackTitle:
          params.conversationTitle || this.createConversationTitle(params.message),
      };

      let enrichedContext: AiContext;
      let conversation: Awaited<ReturnType<AiController["resolveConversation"]>>;

      if (params.conversationId) {
        [enrichedContext, conversation] = await Promise.all([
          this.businessContextService.enrichContext(
            params.message,
            params.context,
            params.actorId,
          ),
          this.resolveConversation(conversationParams),
        ]);
      } else {
        enrichedContext = await this.businessContextService.enrichContext(
          params.message,
          params.context,
          params.actorId,
        );
        conversation = await this.resolveConversation(conversationParams);
      }

      const history = params.conversationId
        ? await this.getConversationHistory(conversation.id, this.getChatHistoryLimit())
        : [];

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
        enrichedContext,
        history,
        {
          model: params.requestedModel,
          actorId: params.actorId,
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
        display: this.responseFormatter.format(providerResult.reply),
        performance: {
          latency_ms: Date.now() - startedAt,
        },
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

  private getAdminActorId(req: Request, res: Response): number | null {
    const actorId = this.getActorId(req);
    if (!actorId) {
      res.status(401).json({
        message: "Not authorized. Token not found",
        data: null,
      });
      return null;
    }

    if (!this.isAdminUser(req)) {
      res.status(403).json({
        message: "Admin access is required for the AI chatbot",
        data: null,
      });
      return null;
    }

    return actorId;
  }

  private getActorId(req: Request): number | null {
    const rawId = (req as any)?.user?.id;
    const parsed = Number(rawId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private isAdminUser(req: Request): boolean {
    const userCategory = String((req as any)?.user?.user_category || "")
      .trim()
      .toLowerCase();
    return userCategory === "admin";
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
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8;
  }

  private buildChatResponseData(result: ChatExecutionResult): Record<string, unknown> {
    return {
      conversation_id: result.conversation_id,
      message_id: result.message_id,
      reply: result.reply,
      display: result.display,
      created_at: result.created_at,
      provider: result.provider,
      model: result.model,
      fallback_used: result.fallback_used,
      fallback_reason: result.fallback_reason,
      usage: result.usage,
      usage_snapshot: result.usage_snapshot,
      performance: result.performance,
    };
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
