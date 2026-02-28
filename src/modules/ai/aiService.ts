import OpenAI, { APIError } from "openai";
import { AiPolicyService } from "./aiPolicyService";
import { AiChatHistoryMessage, AiContext, AiProviderResult, AiUsage } from "./aiTypes";
import { AiCredentialService, AiCredentialServiceError } from "./aiCredentialService";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_OPENAI_MAX_TOKENS = 500;
const DEFAULT_GEMINI_MAX_OUTPUT_TOKENS = 500;
const DEFAULT_GEMINI_API_VERSION = "v1";
const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4"];
const GEMINI_RESTRICTED_PREFIXES = ["gemini-1.5-"];
const GEMINI_DEPRECATED_MODELS = new Set(["gemini-2.0-flash"]);
const GEMINI_RECOMMENDED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
];

type GeminiSdkModule = {
  GoogleGenAI: new (options: {
    apiKey?: string;
    apiVersion?: string;
  }) => {
    models: {
      generateContent: (params: any) => Promise<any>;
    };
  };
};
let geminiSdkModulePromise: Promise<GeminiSdkModule> | null = null;

const loadGeminiSdk = async (): Promise<GeminiSdkModule> => {
  if (!geminiSdkModulePromise) {
    geminiSdkModulePromise = import("@google/genai");
  }
  return geminiSdkModulePromise;
};

type AiProvider = "openai" | "gemini";
type AiGenerationOptions = {
  model?: string;
};

const getPositiveIntEnv = (key: string, fallback: number): number => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const getNumberEnv = (key: string, fallback: number): number => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GeminiMessage = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

export class AiProviderError extends Error {
  status_code: number;
  provider: string;
  payload?: unknown;

  constructor(
    message: string,
    statusCode: number,
    provider: string,
    payload?: unknown,
  ) {
    super(message);
    this.name = "AiProviderError";
    this.status_code = statusCode;
    this.provider = provider;
    this.payload = payload;
  }
}

export class AiService {
  private policy = new AiPolicyService();
  private credentialService = new AiCredentialService();

  async generateReply(
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[] = [],
    options: AiGenerationOptions = {},
  ): Promise<AiProviderResult> {
    const sanitizedMessage = this.policy.sanitizeMessage(message);
    const sanitizedContext = this.policy.sanitizeContext(context);
    const sanitizedHistory = this.sanitizeHistory(history);
    const systemPrompt = this.policy.buildSystemPrompt(sanitizedContext);
    const requestedModel = this.normalizeRequestedModel(options.model);
    const requestedProvider = requestedModel
      ? this.inferProviderFromModel(requestedModel)
      : null;

    if (!requestedModel) {
      throw new AiProviderError("model is required", 400, "ai");
    }

    if (!requestedProvider) {
      throw new AiProviderError(
        "Unsupported model. Use an OpenAI (gpt-/o*) or Gemini (gemini-*) model",
        400,
        "ai",
      );
    }

    if (requestedProvider === "openai") {
      const openAiCredential = await this.safeGetActiveCredential("openai");
      if (!openAiCredential?.api_key) {
        throw new AiProviderError(
          "Selected OpenAI model requires an active OpenAI credential",
          400,
          "openai",
        );
      }

      const openAiResult = await this.callOpenAi(
        openAiCredential.api_key,
        requestedModel as string,
        systemPrompt,
        sanitizedMessage,
        sanitizedContext,
        sanitizedHistory,
      );

      return {
        ...openAiResult,
        fallback_used: false,
      };
    }

    const resolvedGeminiModel = this.normalizeGeminiModelName(requestedModel);
    if (!resolvedGeminiModel) {
      throw new AiProviderError(
        "Unsupported Gemini model format. Use gemini-* or models/gemini-*",
        400,
        "gemini",
      );
    }

    this.assertGeminiModelSupported(resolvedGeminiModel);

    const geminiCredential = await this.safeGetActiveCredential("gemini");
    if (!geminiCredential?.api_key) {
      throw new AiProviderError(
        "Selected Gemini model requires an active Gemini credential",
        400,
        "gemini",
      );
    }

    const geminiResult = await this.callGemini(
      geminiCredential.api_key,
      resolvedGeminiModel,
      systemPrompt,
      sanitizedMessage,
      sanitizedContext,
      sanitizedHistory,
    );
    return {
      ...geminiResult,
      fallback_used: false,
    };
  }

  private async callOpenAi(
    apiKey: string,
    model: string,
    systemPrompt: string,
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    try {
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model,
        temperature: this.getTemperature(),
        max_tokens: this.getOpenAiMaxTokens(),
        messages: this.buildOpenAiMessages(systemPrompt, message, context, history),
      });

      const reply = this.extractOpenAiReply(completion?.choices?.[0]?.message?.content);
      if (!reply) {
        throw new AiProviderError("OpenAI returned an empty response", 502, "openai");
      }

      return {
        reply,
        provider: "openai",
        model,
        usage: {
          prompt_tokens: Number(completion?.usage?.prompt_tokens || 0),
          completion_tokens: Number(completion?.usage?.completion_tokens || 0),
          total_tokens: Number(completion?.usage?.total_tokens || 0),
        },
      };
    } catch (error: any) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      if (error instanceof APIError) {
        throw new AiProviderError(
          error.message || "OpenAI request failed",
          Number(error.status || 502),
          "openai",
          {
            status: error.status,
            code: error.code,
            type: error.type,
            request_id: error.requestID,
            error: error.error,
          },
        );
      }

      throw new AiProviderError(
        error?.message || "OpenAI request failed",
        Number(error?.status || 500),
        "openai",
      );
    }
  }

  private async callGemini(
    apiKey: string,
    model: string,
    systemPrompt: string,
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    try {
      const { GoogleGenAI } = await loadGeminiSdk();
      const gemini = new GoogleGenAI({
        apiKey,
        apiVersion: this.getGeminiApiVersion(),
      });

      const response = await gemini.models.generateContent({
        model,
        contents: this.buildGeminiContents(message, context, history),
        config: {
          systemInstruction: systemPrompt,
          temperature: this.getTemperature(),
          maxOutputTokens: this.getGeminiMaxOutputTokens(),
        },
      });

      const reply = String(response?.text || "").trim();
      if (!reply) {
        throw new AiProviderError("Gemini returned an empty response", 502, "gemini");
      }

      return {
        reply,
        provider: "gemini",
        model,
        usage: {
          prompt_tokens: Number(response?.usageMetadata?.promptTokenCount || 0),
          completion_tokens: Number(response?.usageMetadata?.candidatesTokenCount || 0),
          total_tokens: Number(response?.usageMetadata?.totalTokenCount || 0),
        },
      };
    } catch (error: any) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      if (this.isGeminiApiError(error)) {
        throw new AiProviderError(
          this.buildGeminiModelErrorMessage(
            model,
            error.message || "Gemini request failed",
          ),
          Number(error.status || 502),
          "gemini",
          {
            status: error.status,
            message: error.message,
          },
        );
      }

      throw new AiProviderError(
        error?.message || "Gemini request failed",
        Number(error?.status || 500),
        "gemini",
      );
    }
  }

  private composeUserPrompt(message: string, context: AiContext): string {
    const serializedContext = JSON.stringify(context || {});
    return [
      "User request:",
      message,
      "",
      "Context payload:",
      serializedContext,
    ].join("\n");
  }

  private sanitizeHistory(history: AiChatHistoryMessage[]): AiChatHistoryMessage[] {
    if (!Array.isArray(history) || history.length === 0) {
      return [];
    }

    return history
      .map((entry) => {
        const role = entry?.role === "assistant" ? "assistant" : "user";
        const content = this.policy.sanitizeMessage(String(entry?.content || ""));
        return { role, content } as AiChatHistoryMessage;
      })
      .filter((entry) => entry.content.length > 0);
  }

  private buildOpenAiMessages(
    systemPrompt: string,
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
  ): OpenAiChatMessage[] {
    const messages: OpenAiChatMessage[] = [{ role: "system", content: systemPrompt }];

    for (const historyEntry of history) {
      messages.push({
        role: historyEntry.role,
        content: historyEntry.content,
      });
    }

    messages.push({
      role: "user",
      content: this.composeUserPrompt(message, context),
    });

    return messages;
  }

  private extractOpenAiReply(content: unknown): string {
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part && typeof part === "object" && "text" in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .join(" ")
        .trim();
    }

    return "";
  }

  private buildGeminiContents(
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
  ): GeminiMessage[] {
    const contents: GeminiMessage[] = [];

    for (const historyEntry of history) {
      contents.push({
        role: historyEntry.role === "assistant" ? "model" : "user",
        parts: [{ text: historyEntry.content }],
      });
    }

    contents.push({
      role: "user",
      parts: [{ text: this.composeUserPrompt(message, context) }],
    });

    return contents;
  }

  private getTemperature(): number {
    const value = getNumberEnv("AI_TEMPERATURE", DEFAULT_TEMPERATURE);
    if (value < 0) return 0;
    if (value > 2) return 2;
    return value;
  }

  private getOpenAiMaxTokens(): number {
    return getPositiveIntEnv("OPENAI_MAX_TOKENS", DEFAULT_OPENAI_MAX_TOKENS);
  }

  private getGeminiMaxOutputTokens(): number {
    return getPositiveIntEnv(
      "GEMINI_MAX_OUTPUT_TOKENS",
      DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
    );
  }

  private normalizeRequestedModel(modelInput?: string): string | null {
    const model = String(modelInput || "").trim();
    return model || null;
  }

  private inferProviderFromModel(model: string): AiProvider | null {
    const geminiModel = this.normalizeGeminiModelName(model);
    if (geminiModel) {
      return "gemini";
    }

    const normalized = model.toLowerCase();

    if (OPENAI_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      return "openai";
    }

    return null;
  }

  private isGeminiApiError(error: unknown): error is { status?: number; message: string } {
    if (!error || typeof error !== "object") {
      return false;
    }

    const status = (error as { status?: unknown }).status;
    const message = (error as { message?: unknown }).message;
    return typeof status === "number" && typeof message === "string";
  }

  private normalizeGeminiModelName(modelInput: string): string | null {
    const model = String(modelInput || "").trim();
    if (!model) {
      return null;
    }

    const normalized = model.toLowerCase();

    if (normalized.startsWith("models/gemini-")) {
      return model.slice("models/".length);
    }

    if (normalized.startsWith("google/gemini-")) {
      return model.slice("google/".length);
    }

    if (normalized.includes("/models/gemini-")) {
      const marker = normalized.lastIndexOf("/models/");
      if (marker >= 0) {
        return model.slice(marker + "/models/".length);
      }
    }

    if (normalized.startsWith("gemini-") || normalized.startsWith("tunedmodels/")) {
      return model;
    }

    return null;
  }

  private assertGeminiModelSupported(model: string): void {
    const normalized = model.toLowerCase();
    const suggestion = `Use one of: ${GEMINI_RECOMMENDED_MODELS.join(", ")}.`;

    if (normalized.startsWith("tunedmodels/")) {
      return;
    }

    if (GEMINI_RESTRICTED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw new AiProviderError(
        `Model "${model}" is restricted for this integration. ${suggestion}`,
        400,
        "gemini",
      );
    }

    if (GEMINI_DEPRECATED_MODELS.has(normalized)) {
      throw new AiProviderError(
        `Model "${model}" is deprecated for new users. ${suggestion}`,
        400,
        "gemini",
      );
    }

    if (normalized.endsWith("-latest")) {
      throw new AiProviderError(
        `Model "${model}" is a legacy alias and may fail unpredictably. ${suggestion}`,
        400,
        "gemini",
      );
    }
  }

  private buildGeminiModelErrorMessage(
    model: string,
    providerMessage: string,
  ): string {
    const base = String(providerMessage || "Gemini request failed");
    const lowered = base.toLowerCase();
    const modelMismatch = [
      "not found for api version",
      "no longer available",
      "not found",
      "unsupported model",
      "invalid model",
    ].some((needle) => lowered.includes(needle));

    if (!modelMismatch) {
      return base;
    }

    return `Model "${model}" is unavailable for this API key/version. Use @google/genai with apiVersion=v1 and try: ${GEMINI_RECOMMENDED_MODELS.join(", ")}.`;
  }

  private getGeminiApiVersion(): "v1" | "v1beta" | "v1alpha" {
    const value = String(process.env.GEMINI_API_VERSION || DEFAULT_GEMINI_API_VERSION)
      .trim()
      .toLowerCase();

    if (value === "v1beta" || value === "v1alpha") {
      return value;
    }

    return "v1";
  }

  private async safeGetActiveCredential(provider: "openai" | "gemini") {
    try {
      return await this.credentialService.getActiveCredential(provider);
    } catch (error: any) {
      if (
        error instanceof AiCredentialServiceError &&
        error.message.toLowerCase().includes("no active")
      ) {
        return null;
      }
      throw new AiProviderError(
        error?.message || `Failed to load ${provider} credentials`,
        error?.status_code || 500,
        provider,
      );
    }
  }
}
