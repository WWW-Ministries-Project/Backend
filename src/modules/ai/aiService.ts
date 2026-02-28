import { AiPolicyService } from "./aiPolicyService";
import { AiContext, AiProviderResult, AiUsage } from "./aiTypes";
import { AiCredentialService, AiCredentialServiceError } from "./aiCredentialService";

type OpenAiResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
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

  async generateReply(message: string, context: AiContext): Promise<AiProviderResult> {
    const sanitizedMessage = this.policy.sanitizeMessage(message);
    const sanitizedContext = this.policy.sanitizeContext(context);
    const systemPrompt = this.policy.buildSystemPrompt(sanitizedContext);

    const openAiCredential = await this.safeGetActiveCredential("openai");
    const geminiCredential = await this.safeGetActiveCredential("gemini");

    if (!openAiCredential && !geminiCredential) {
      throw new AiProviderError("No active AI credentials configured", 500, "ai");
    }

    if (openAiCredential?.api_key) {
      try {
        const openAiResult = await this.callOpenAi(
          openAiCredential.api_key,
          systemPrompt,
          sanitizedMessage,
          sanitizedContext,
        );

        return {
          ...openAiResult,
          fallback_used: false,
        };
      } catch (error: any) {
        if (!geminiCredential?.api_key || !this.isOpenAiTokenExhaustion(error)) {
          throw error;
        }

        const geminiResult = await this.callGemini(
          geminiCredential.api_key,
          systemPrompt,
          sanitizedMessage,
          sanitizedContext,
        );

        return {
          ...geminiResult,
          fallback_used: true,
          fallback_reason: "OpenAI token exhausted",
        };
      }
    }

    const geminiResult = await this.callGemini(
      geminiCredential?.api_key as string,
      systemPrompt,
      sanitizedMessage,
      sanitizedContext,
    );
    return {
      ...geminiResult,
      fallback_used: false,
    };
  }

  private async callOpenAi(
    apiKey: string,
    systemPrompt: string,
    message: string,
    context: AiContext,
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: this.composeUserPrompt(message, context),
          },
        ],
      }),
    });

    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new AiProviderError(
        payload?.error?.message || "OpenAI request failed",
        response.status,
        "openai",
        payload,
      );
    }

    const rawContent = payload?.choices?.[0]?.message?.content;
    let reply = "";
    if (typeof rawContent === "string") {
      reply = rawContent.trim();
    } else if (Array.isArray(rawContent)) {
      reply = rawContent
        .map((part) => part?.text || "")
        .join(" ")
        .trim();
    }

    if (!reply) {
      throw new AiProviderError("OpenAI returned an empty response", 502, "openai");
    }

    return {
      reply,
      provider: "openai",
      model,
      usage: {
        prompt_tokens: Number(payload?.usage?.prompt_tokens || 0),
        completion_tokens: Number(payload?.usage?.completion_tokens || 0),
        total_tokens: Number(payload?.usage?.total_tokens || 0),
      },
    };
  }

  private async callGemini(
    apiKey: string,
    systemPrompt: string,
    message: string,
    context: AiContext,
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\n${this.composeUserPrompt(message, context)}`,
              },
            ],
          },
        ],
      }),
    });

    const payload = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new AiProviderError(
        payload?.error?.message || "Gemini request failed",
        response.status,
        "gemini",
        payload,
      );
    }

    const reply = (payload?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || "")
      .join(" ")
      .trim();

    if (!reply) {
      throw new AiProviderError("Gemini returned an empty response", 502, "gemini");
    }

    return {
      reply,
      provider: "gemini",
      model,
      usage: {
        prompt_tokens: Number(payload?.usageMetadata?.promptTokenCount || 0),
        completion_tokens: Number(payload?.usageMetadata?.candidatesTokenCount || 0),
        total_tokens: Number(payload?.usageMetadata?.totalTokenCount || 0),
      },
    };
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

  private isOpenAiTokenExhaustion(error: unknown): boolean {
    if (!(error instanceof AiProviderError)) {
      return false;
    }

    if (error.provider !== "openai") {
      return false;
    }

    const payload = (error.payload || {}) as OpenAiResponse;
    const errorCode = String(payload?.error?.code || "").toLowerCase();
    const errorType = String(payload?.error?.type || "").toLowerCase();
    const errorMessage = String(payload?.error?.message || error.message || "").toLowerCase();

    if (
      errorCode.includes("insufficient_quota") ||
      errorCode.includes("quota")
    ) {
      return true;
    }

    if (errorType.includes("insufficient_quota") || errorType.includes("quota")) {
      return true;
    }

    return (
      errorMessage.includes("insufficient quota") ||
      errorMessage.includes("quota") ||
      errorMessage.includes("billing hard limit") ||
      errorMessage.includes("billing limit") ||
      errorMessage.includes("exceeded your current quota") ||
      errorMessage.includes("tokens per minute quota")
    );
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
