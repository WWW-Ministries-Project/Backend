import Anthropic, { APIError as AnthropicAPIError } from "@anthropic-ai/sdk";
import OpenAI, { APIError as OpenAiAPIError } from "openai";
import { AiPolicyService } from "./aiPolicyService";
import { AiChatHistoryMessage, AiContext, AiProviderResult, AiUsage } from "./aiTypes";
import { AiCredentialService, AiCredentialServiceError } from "./aiCredentialService";
import { AiReadOnlyDataService } from "./aiReadOnlyDataService";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_OPENAI_MAX_TOKENS = 400;
const DEFAULT_CLAUDE_MAX_TOKENS = 400;
const DEFAULT_GEMINI_MAX_OUTPUT_TOKENS = 400;
const DEFAULT_GEMINI_API_VERSION = "v1beta";
const CLAUDE_MODEL_PREFIXES = ["claude-"];
const CLAUDE_RECOMMENDED_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
];
const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4"];
const GEMINI_RESTRICTED_PREFIXES = ["gemini-1.5-"];
const GEMINI_DEPRECATED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
]);
const GEMINI_RECOMMENDED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
];
const AI_TOOL_MAX_ROUNDS = 3;
const AI_TOOL_MAX_CALLS_PER_ROUND = 2;
const OPENAI_TOOL_NAME_LIST_CONTRACTS = "list_read_only_query_contracts";
const OPENAI_TOOL_NAME_READ_MODULE = "read_module_data";

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

type AiProvider = "openai" | "gemini" | "claude";
type AiGenerationOptions = {
  model?: string;
  actorId?: number;
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
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: any[];
};

type GeminiPart = {
  text?: string;
  functionCall?: Record<string, unknown>;
  functionResponse?: Record<string, unknown>;
  [key: string]: unknown;
};

type GeminiMessage = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | any[];
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
  private readOnlyDataService = new AiReadOnlyDataService();

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
        "Unsupported model. Use an OpenAI (gpt-/o*), Claude (claude-*), or Gemini (gemini-*) model",
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
        options.actorId,
      );

      return {
        ...openAiResult,
        fallback_used: false,
      };
    }

    if (requestedProvider === "claude") {
      const resolvedClaudeModel = this.normalizeClaudeModelName(requestedModel);
      if (!resolvedClaudeModel) {
        throw new AiProviderError(
          "Unsupported Claude model format. Use claude-* or anthropic/claude-*",
          400,
          "claude",
        );
      }

      const claudeCredential = await this.safeGetActiveCredential("claude");
      if (!claudeCredential?.api_key) {
        throw new AiProviderError(
          "Selected Claude model requires an active Claude credential",
          400,
          "claude",
        );
      }

      const claudeResult = await this.callClaude(
        claudeCredential.api_key,
        resolvedClaudeModel,
        systemPrompt,
        sanitizedMessage,
        sanitizedContext,
        sanitizedHistory,
        options.actorId,
      );

      return {
        ...claudeResult,
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
      options.actorId,
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
    actorId?: number,
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    try {
      const openai = new OpenAI({ apiKey });
      const messages: any[] = this.buildOpenAiMessages(
        systemPrompt,
        message,
        context,
        history,
      );
      const tools = this.buildOpenAiTools();
      const usage: AiUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      const maxToolRounds = this.getToolMaxRounds();
      const maxToolCallsPerRound = this.getToolMaxCallsPerRound();

      for (let round = 0; round < maxToolRounds; round += 1) {
        const completion = await openai.chat.completions.create({
          model,
          temperature: this.getTemperature(),
          max_tokens: this.getOpenAiMaxTokens(),
          messages: messages as any,
          tools: tools as any,
          tool_choice: "auto",
        });

        usage.prompt_tokens += Number(completion?.usage?.prompt_tokens || 0);
        usage.completion_tokens += Number(completion?.usage?.completion_tokens || 0);
        usage.total_tokens += Number(completion?.usage?.total_tokens || 0);

        const assistantMessage = completion?.choices?.[0]?.message;
        if (!assistantMessage) {
          throw new AiProviderError("OpenAI returned an empty response", 502, "openai");
        }

        const toolCalls = Array.isArray((assistantMessage as any).tool_calls)
          ? ((assistantMessage as any).tool_calls as any[]).slice(0, maxToolCallsPerRound)
          : [];

        if (!toolCalls.length) {
          const reply = this.extractOpenAiReply(assistantMessage.content);
          if (!reply) {
            throw new AiProviderError("OpenAI returned an empty response", 502, "openai");
          }

          return {
            reply,
            provider: "openai",
            model,
            usage,
          };
        }

        messages.push({
          role: "assistant",
          content: assistantMessage.content || "",
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const toolResult = await this.executeOpenAiToolCall(toolCall, actorId);
          messages.push({
            role: "tool",
            tool_call_id: String(toolCall?.id || ""),
            content: JSON.stringify(toolResult),
          });
        }
      }

      throw new AiProviderError(
        "OpenAI tool-calling did not produce a final response",
        502,
        "openai",
      );
    } catch (error: any) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      if (error instanceof OpenAiAPIError) {
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

  private async callClaude(
    apiKey: string,
    model: string,
    systemPrompt: string,
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
    actorId?: number,
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    try {
      const anthropic = new Anthropic({ apiKey });
      const messages: ClaudeMessage[] = this.buildClaudeMessages(
        message,
        context,
        history,
      );
      const tools = this.buildClaudeTools();
      const usage: AiUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      const maxToolRounds = this.getToolMaxRounds();
      const maxToolCallsPerRound = this.getToolMaxCallsPerRound();

      for (let round = 0; round < maxToolRounds; round += 1) {
        const response = await anthropic.messages.create({
          model,
          system: systemPrompt,
          temperature: this.getClaudeTemperature(),
          max_tokens: this.getClaudeMaxTokens(),
          messages: messages as any,
          tools: tools as any,
        });

        const roundUsage = this.extractClaudeUsage(response?.usage);
        usage.prompt_tokens += roundUsage.prompt_tokens;
        usage.completion_tokens += roundUsage.completion_tokens;
        usage.total_tokens += roundUsage.total_tokens;

        const contentBlocks = Array.isArray(response?.content)
          ? (response.content as any[])
          : [];
        const toolUses = contentBlocks
          .filter((block) => block?.type === "tool_use")
          .slice(0, maxToolCallsPerRound);

        if (!toolUses.length) {
          const reply = this.extractClaudeReply(contentBlocks);
          if (!reply) {
            throw new AiProviderError("Claude returned an empty response", 502, "claude");
          }

          return {
            reply,
            provider: "claude",
            model,
            usage,
          };
        }

        const selectedToolIds = new Set(
          toolUses.map((toolUse) => String(toolUse?.id || "")).filter(Boolean),
        );
        const assistantContent = contentBlocks.filter(
          (block) =>
            block?.type !== "tool_use" || selectedToolIds.has(String(block?.id || "")),
        );

        messages.push({
          role: "assistant",
          content: assistantContent,
        });

        const toolResults: Array<Record<string, unknown>> = [];
        for (const toolUse of toolUses) {
          const toolResult = await this.executeClaudeToolCall(toolUse, actorId);
          toolResults.push({
            type: "tool_result",
            tool_use_id: String(toolUse?.id || ""),
            content: JSON.stringify(toolResult),
            is_error: toolResult.ok === false,
          });
        }

        messages.push({
          role: "user",
          content: toolResults,
        });
      }

      throw new AiProviderError(
        "Claude tool-calling did not produce a final response",
        502,
        "claude",
      );
    } catch (error: any) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      if (error instanceof AnthropicAPIError) {
        throw new AiProviderError(
          this.buildClaudeModelErrorMessage(
            model,
            error.message || "Claude request failed",
          ),
          Number(error.status || 502),
          "claude",
          {
            status: error.status,
            request_id: error.requestID,
            error: error.error,
          },
        );
      }

      throw new AiProviderError(
        error?.message || "Claude request failed",
        Number(error?.status || 500),
        "claude",
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
    actorId?: number,
  ): Promise<{ reply: string; provider: string; model: string; usage: AiUsage }> {
    try {
      const { GoogleGenAI } = await loadGeminiSdk();
      const gemini = new GoogleGenAI({
        apiKey,
        apiVersion: this.getGeminiApiVersion(),
      });

      const baseConfig = {
        temperature: this.getTemperature(),
        maxOutputTokens: this.getGeminiMaxOutputTokens(),
      };
      const tools = this.buildGeminiTools();
      const usage: AiUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      const contents: GeminiMessage[] = this.buildGeminiContents(message, context, history);
      let useInlineSystemPrompt = false;
      const maxToolRounds = this.getToolMaxRounds();
      const maxToolCallsPerRound = this.getToolMaxCallsPerRound();

      for (let round = 0; round < maxToolRounds; round += 1) {
        let response;
        try {
          response = await gemini.models.generateContent({
            model,
            contents: useInlineSystemPrompt
              ? this.prependGeminiSystemPrompt(contents, systemPrompt)
              : contents,
            config: {
              ...baseConfig,
              ...(useInlineSystemPrompt ? {} : { systemInstruction: systemPrompt }),
              toolConfig: {
                functionCallingConfig: {
                  mode: "AUTO",
                },
              },
              tools,
            },
          });
        } catch (firstError) {
          if (
            useInlineSystemPrompt ||
            !this.isGeminiSystemInstructionUnsupportedError(firstError)
          ) {
            throw firstError;
          }

          useInlineSystemPrompt = true;
          response = await gemini.models.generateContent({
            model,
            contents: this.prependGeminiSystemPrompt(contents, systemPrompt),
            config: {
              ...baseConfig,
              toolConfig: {
                functionCallingConfig: {
                  mode: "AUTO",
                },
              },
              tools,
            },
          });
        }

        usage.prompt_tokens += Number(response?.usageMetadata?.promptTokenCount || 0);
        usage.completion_tokens += Number(response?.usageMetadata?.candidatesTokenCount || 0);
        usage.total_tokens += Number(response?.usageMetadata?.totalTokenCount || 0);

        const functionCalls = this.extractGeminiFunctionCalls(response).slice(
          0,
          maxToolCallsPerRound,
        );

        if (!functionCalls.length) {
          const reply = this.extractGeminiReply(response);
          if (!reply) {
            const recoveredReply = await this.retryGeminiFinalReply(
              gemini,
              model,
              contents,
              systemPrompt,
              useInlineSystemPrompt,
              baseConfig,
              usage,
            );

            if (!recoveredReply) {
              throw new AiProviderError(
                this.buildGeminiEmptyResponseMessage(response),
                502,
                "gemini",
                this.extractGeminiEmptyResponsePayload(response),
              );
            }

            return {
              reply: recoveredReply,
              provider: "gemini",
              model,
              usage,
            };
          }

          return {
            reply,
            provider: "gemini",
            model,
            usage,
          };
        }

        const toolResponseParts: GeminiPart[] = [];
        for (const functionCall of functionCalls) {
          const toolResult = await this.executeGeminiToolCall(functionCall, actorId);
          toolResponseParts.push({
            functionResponse: {
              id:
                typeof functionCall?.id === "string" && functionCall.id.trim()
                  ? functionCall.id
                  : undefined,
              name: String(functionCall?.name || ""),
              response: toolResult,
            },
          });
        }

        contents.push(this.extractGeminiModelContent(response, functionCalls));
        contents.push({
          role: "user",
          parts: toolResponseParts,
        });
      }

      throw new AiProviderError(
        "Gemini tool-calling did not produce a final response",
        502,
        "gemini",
      );
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

  private buildOpenAiTools(): any[] {
    return [
      {
        type: "function",
        function: {
          name: OPENAI_TOOL_NAME_LIST_CONTRACTS,
          description:
            "List read-only query contracts by module so you know what data can be fetched safely.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              module: {
                type: "string",
                description: "Optional module name (e.g., event, user, requisitions).",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: OPENAI_TOOL_NAME_READ_MODULE,
          description:
            "Run a read-only query contract against a backend module to fetch grounded facts.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["module", "operation"],
            properties: {
              module: {
                type: "string",
                description: "Module name from list_read_only_query_contracts.",
              },
              operation: {
                type: "string",
                description:
                  "Operation name from the selected module contract (for example summary, recent, search, queue, attendance_lookup, early_arrivals, attendance_timing).",
              },
              input: {
                type: "object",
                description: "Operation input arguments (e.g., q, date, event_id, limit).",
              },
              cross_module: {
                type: "boolean",
                description:
                  "Optional. Set true when answering a question that requires data from multiple modules.",
              },
            },
          },
        },
      },
    ];
  }

  private buildClaudeTools(): any[] {
    return [
      {
        name: OPENAI_TOOL_NAME_LIST_CONTRACTS,
        description:
          "List read-only query contracts by module so you know what data can be fetched safely.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            module: {
              type: "string",
              description: "Optional module name (e.g., event, user, requisitions).",
            },
          },
        },
      },
      {
        name: OPENAI_TOOL_NAME_READ_MODULE,
        description:
          "Run a read-only query contract against a backend module to fetch grounded facts.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["module", "operation"],
          properties: {
            module: {
              type: "string",
              description: "Module name from list_read_only_query_contracts.",
            },
            operation: {
              type: "string",
              description:
                "Operation name from the selected module contract (for example summary, recent, search, queue, attendance_lookup, early_arrivals, attendance_timing).",
            },
            input: {
              type: "object",
              description: "Operation input arguments (e.g., q, date, event_id, limit).",
            },
            cross_module: {
              type: "boolean",
              description:
                "Optional. Set true when answering a question that requires data from multiple modules.",
            },
          },
        },
      },
    ];
  }

  private buildGeminiTools(): any[] {
    return [
      {
        functionDeclarations: [
          {
            name: OPENAI_TOOL_NAME_LIST_CONTRACTS,
            description:
              "List read-only query contracts by module so you know what data can be fetched safely.",
            parametersJsonSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                module: {
                  type: "string",
                  description: "Optional module name (e.g., event, user, requisitions).",
                },
              },
            },
          },
          {
            name: OPENAI_TOOL_NAME_READ_MODULE,
            description:
              "Run a read-only query contract against a backend module to fetch grounded facts.",
            parametersJsonSchema: {
              type: "object",
              additionalProperties: false,
              required: ["module", "operation"],
              properties: {
                module: {
                  type: "string",
                  description: "Module name from list_read_only_query_contracts.",
                },
                operation: {
                type: "string",
                description:
                    "Operation name from the selected module contract (for example summary, recent, search, queue, attendance_lookup, early_arrivals, attendance_timing).",
                },
                input: {
                  type: "object",
                  description: "Operation input arguments (e.g., q, date, event_id, limit).",
                },
                cross_module: {
                  type: "boolean",
                  description:
                    "Optional. Set true when answering a question that requires data from multiple modules.",
                },
              },
            },
          },
        ],
      },
    ];
  }

  private parseToolArguments(raw: unknown): Record<string, unknown> {
    if (typeof raw !== "string" || !raw.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch (error) {
      return {};
    }
  }

  private async executeOpenAiToolCall(toolCall: any, actorId?: number) {
    const toolName = String(toolCall?.function?.name || "").trim();
    const args = this.parseToolArguments(toolCall?.function?.arguments);

    return this.executeToolCall(toolName, args, actorId);
  }

  private async executeClaudeToolCall(toolUse: any, actorId?: number) {
    const toolName = String(toolUse?.name || "").trim();
    const args =
      toolUse?.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input)
        ? (toolUse.input as Record<string, unknown>)
        : {};

    return this.executeToolCall(toolName, args, actorId);
  }

  private async executeGeminiToolCall(functionCall: any, actorId?: number) {
    const toolName = String(functionCall?.name || "").trim();
    const args =
      functionCall?.args &&
      typeof functionCall.args === "object" &&
      !Array.isArray(functionCall.args)
        ? (functionCall.args as Record<string, unknown>)
        : {};

    return this.executeToolCall(toolName, args, actorId);
  }

  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    actorId?: number,
  ) {
    try {
      if (toolName === OPENAI_TOOL_NAME_LIST_CONTRACTS) {
        const moduleName = typeof args.module === "string" ? args.module : undefined;
        return {
          ok: true,
          tool: OPENAI_TOOL_NAME_LIST_CONTRACTS,
          data: this.readOnlyDataService.listContracts(moduleName),
        };
      }

      if (toolName === OPENAI_TOOL_NAME_READ_MODULE) {
        const moduleName = typeof args.module === "string" ? args.module : "";
        const operation = typeof args.operation === "string" ? args.operation : "";
        const input =
          args.input && typeof args.input === "object" && !Array.isArray(args.input)
            ? (args.input as Record<string, unknown>)
            : {};
        const crossModule = true;

        const data = await this.readOnlyDataService.executeQuery({
          module: moduleName,
          operation,
          input,
          actorId,
          crossModule,
        });

        return {
          ok: true,
          tool: OPENAI_TOOL_NAME_READ_MODULE,
          data,
        };
      }

      return {
        ok: false,
        error: `Unsupported tool call: ${toolName}`,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message || "Tool execution failed",
      };
    }
  }

  private buildClaudeMessages(
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
  ): ClaudeMessage[] {
    const messages: ClaudeMessage[] = [];

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

  private extractClaudeReply(content: unknown): string {
    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .map((block) => {
        if (block && typeof block === "object" && (block as any).type === "text") {
          const text = (block as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join(" ")
      .trim();
  }

  private extractClaudeUsage(rawUsage: any): AiUsage {
    const baseInput = Number(rawUsage?.input_tokens || 0);
    const cacheCreation = Number(rawUsage?.cache_creation_input_tokens || 0);
    const cacheRead = Number(rawUsage?.cache_read_input_tokens || 0);
    const promptTokens = baseInput + cacheCreation + cacheRead;
    const completionTokens = Number(rawUsage?.output_tokens || 0);

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
  }

  private buildGeminiContents(
    message: string,
    context: AiContext,
    history: AiChatHistoryMessage[],
    fallbackSystemPrompt?: string,
  ): GeminiMessage[] {
    const contents: GeminiMessage[] = [];

    if (fallbackSystemPrompt?.trim()) {
      contents.push({
        role: "user",
        parts: [{ text: `System instructions:\n${fallbackSystemPrompt}` }],
      });
    }

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

  private prependGeminiSystemPrompt(
    contents: GeminiMessage[],
    systemPrompt: string,
  ): GeminiMessage[] {
    if (!systemPrompt.trim()) {
      return [...contents];
    }

    return [
      {
        role: "user",
        parts: [{ text: `System instructions:\n${systemPrompt}` }],
      },
      ...contents,
    ];
  }

  private extractGeminiFunctionCalls(response: any): any[] {
    if (Array.isArray(response?.functionCalls)) {
      return response.functionCalls.filter(
        (entry: any) => entry && typeof entry?.name === "string" && entry.name.trim(),
      );
    }

    const candidateParts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(candidateParts)) {
      return [];
    }

    return candidateParts
      .map((part: any) => part?.functionCall)
      .filter((entry: any) => entry && typeof entry?.name === "string" && entry.name.trim());
  }

  private extractGeminiReply(response: any): string {
    const responseText = typeof response?.text === "string" ? response.text.trim() : "";
    if (responseText) {
      return responseText;
    }

    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      const candidateText = parts
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join(" ")
        .trim();

      if (candidateText) {
        return candidateText;
      }
    }

    return "";
  }

  private extractGeminiModelContent(response: any, functionCalls: any[]): GeminiMessage {
    const candidateContent = response?.candidates?.[0]?.content;
    if (candidateContent && Array.isArray(candidateContent.parts) && candidateContent.parts.length) {
      return {
        role: candidateContent.role === "user" ? "user" : "model",
        parts: candidateContent.parts as GeminiPart[],
      };
    }

    return {
      role: "model",
      parts: functionCalls.map((functionCall) => ({
        functionCall,
      })),
    };
  }

  private async retryGeminiFinalReply(
    gemini: GeminiSdkModule["GoogleGenAI"]["prototype"],
    model: string,
    contents: GeminiMessage[],
    systemPrompt: string,
    useInlineSystemPrompt: boolean,
    baseConfig: Record<string, unknown>,
    usage: AiUsage,
  ): Promise<string> {
    try {
      const recoveryContents: GeminiMessage[] = [
        ...contents,
        {
          role: "user",
          parts: [
            {
              text:
                "Answer the original request directly using the tool results and context already in this conversation. Do not call any tools. If the data is insufficient, say exactly what is missing.",
            },
          ],
        },
      ];

      const recoveryResponse = await gemini.models.generateContent({
        model,
        contents: useInlineSystemPrompt
          ? this.prependGeminiSystemPrompt(recoveryContents, systemPrompt)
          : recoveryContents,
        config: {
          ...baseConfig,
          ...(useInlineSystemPrompt ? {} : { systemInstruction: systemPrompt }),
        },
      });

      usage.prompt_tokens += Number(recoveryResponse?.usageMetadata?.promptTokenCount || 0);
      usage.completion_tokens += Number(
        recoveryResponse?.usageMetadata?.candidatesTokenCount || 0,
      );
      usage.total_tokens += Number(recoveryResponse?.usageMetadata?.totalTokenCount || 0);

      return this.extractGeminiReply(recoveryResponse);
    } catch (error) {
      return "";
    }
  }

  private buildGeminiEmptyResponseMessage(response: any): string {
    const finishReason = String(response?.candidates?.[0]?.finishReason || "").trim();
    const blockReason = String(response?.promptFeedback?.blockReason || "").trim();
    const reasons = [
      finishReason ? `finishReason=${finishReason}` : "",
      blockReason ? `blockReason=${blockReason}` : "",
    ].filter(Boolean);

    return reasons.length
      ? `Gemini returned no text or tool calls (${reasons.join(", ")}).`
      : "Gemini returned an empty response.";
  }

  private extractGeminiEmptyResponsePayload(response: any) {
    return {
      finish_reason: response?.candidates?.[0]?.finishReason || null,
      block_reason: response?.promptFeedback?.blockReason || null,
      parts_count: Array.isArray(response?.candidates?.[0]?.content?.parts)
        ? response.candidates[0].content.parts.length
        : 0,
    };
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

  private getClaudeMaxTokens(): number {
    return getPositiveIntEnv("CLAUDE_MAX_TOKENS", DEFAULT_CLAUDE_MAX_TOKENS);
  }

  private getClaudeTemperature(): number {
    const value = this.getTemperature();
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private getGeminiMaxOutputTokens(): number {
    return getPositiveIntEnv(
      "GEMINI_MAX_OUTPUT_TOKENS",
      DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
    );
  }

  private getToolMaxRounds(): number {
    return getPositiveIntEnv("AI_TOOL_MAX_ROUNDS", AI_TOOL_MAX_ROUNDS);
  }

  private getToolMaxCallsPerRound(): number {
    return getPositiveIntEnv(
      "AI_TOOL_MAX_CALLS_PER_ROUND",
      AI_TOOL_MAX_CALLS_PER_ROUND,
    );
  }

  private normalizeRequestedModel(modelInput?: string): string | null {
    const model = String(modelInput || "").trim();
    return model || null;
  }

  private inferProviderFromModel(model: string): AiProvider | null {
    const claudeModel = this.normalizeClaudeModelName(model);
    if (claudeModel) {
      return "claude";
    }

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

  private normalizeClaudeModelName(modelInput: string): string | null {
    const model = String(modelInput || "").trim();
    if (!model) {
      return null;
    }

    const normalized = model.toLowerCase();

    if (normalized.startsWith("anthropic/claude-")) {
      return model.slice("anthropic/".length);
    }

    if (normalized.startsWith("models/claude-")) {
      return model.slice("models/".length);
    }

    if (normalized.includes("/models/claude-")) {
      const marker = normalized.lastIndexOf("/models/");
      if (marker >= 0) {
        return model.slice(marker + "/models/".length);
      }
    }

    if (CLAUDE_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      return model;
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

  private isGeminiSystemInstructionUnsupportedError(error: unknown): boolean {
    if (!this.isGeminiApiError(error)) {
      return false;
    }

    const message = String(error.message || "").toLowerCase();
    return (
      message.includes("unknown name") &&
      message.includes("systeminstruction")
    );
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

    if (normalized.startsWith("gemini-2.0-flash-lite")) {
      throw new AiProviderError(
        `Model "${model}" does not support Gemini function calling in this database-backed workflow. ${suggestion}`,
        400,
        "gemini",
      );
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

    return `Model "${model}" is unavailable for this API key/version. Try a supported Gemini API version and one of: ${GEMINI_RECOMMENDED_MODELS.join(", ")}.`;
  }

  private buildClaudeModelErrorMessage(
    model: string,
    providerMessage: string,
  ): string {
    const base = String(providerMessage || "Claude request failed");
    const lowered = base.toLowerCase();
    const modelMismatch = [
      "invalid model",
      "model not found",
      "unsupported model",
      "unknown model",
      "not_found_error",
    ].some((needle) => lowered.includes(needle));

    if (!modelMismatch) {
      return base;
    }

    return `Model "${model}" is unavailable for this Anthropic API key. Try: ${CLAUDE_RECOMMENDED_MODELS.join(", ")}.`;
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

  private async safeGetActiveCredential(provider: "openai" | "gemini" | "claude") {
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
