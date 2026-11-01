import { prisma } from "../../Models/context";

/**
 * Central, DB-backed configuration for the AI assistant.
 *
 * Tunables that used to live only in environment variables (model limits, tool
 * rounds, temperature, chat history depth, monthly quotas) are now editable at
 * runtime from the AI Console. Resolution order for every setting is:
 *
 *   DB row (ai_setting)  ->  environment variable  ->  hardcoded default
 *
 * The env layer is kept so existing deployments keep their current behaviour
 * until an admin saves a value, and so secrets-style overrides remain possible.
 */

export class AiSettingsServiceError extends Error {
  status_code: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AiSettingsServiceError";
    this.status_code = statusCode;
  }
}

export type AiSettingType = "int" | "float" | "string" | "enum";

export type AiSettingGroup =
  | "models"
  | "generation"
  | "tools"
  | "quota"
  | "advanced";

export type AiSettingDefinition = {
  key: string;
  group: AiSettingGroup;
  type: AiSettingType;
  label: string;
  description: string;
  /** Hardcoded fallback when neither DB nor env supplies a value. */
  default: number | string;
  /** Legacy env var consulted before the hardcoded default. */
  envKey?: string;
  min?: number;
  max?: number;
  step?: number;
  enumValues?: string[];
  /** Hint for the console UI; the backend does not treat these as secret. */
  unit?: string;
};

export type AiResolvedSetting = {
  key: string;
  group: AiSettingGroup;
  type: AiSettingType;
  label: string;
  description: string;
  value: number | string;
  default: number | string;
  source: "db" | "env" | "default";
  min?: number;
  max?: number;
  step?: number;
  enumValues?: string[];
  unit?: string;
};

/**
 * The catalog is the single source of truth for which settings exist, how they
 * are typed/validated, and what the (smart) defaults are. Adding a tunable here
 * makes it readable by the services and editable in the console automatically.
 */
export const AI_SETTINGS_CATALOG: AiSettingDefinition[] = [
  // --- models ---------------------------------------------------------------
  {
    key: "default_chat_model",
    group: "models",
    type: "string",
    label: "Default chat model",
    description:
      "Preferred model for the assistant chat. Must have an active credential for its provider; otherwise the first available model is used.",
    default: "claude-sonnet-4-6",
    envKey: "AI_DEFAULT_CHAT_MODEL",
  },

  // --- generation -----------------------------------------------------------
  {
    key: "temperature",
    group: "generation",
    type: "float",
    label: "Temperature",
    description: "Sampling temperature. Lower is more deterministic.",
    default: 0.3,
    envKey: "AI_TEMPERATURE",
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    key: "openai_max_tokens",
    group: "generation",
    type: "int",
    label: "OpenAI max output tokens",
    description: "Maximum response length for OpenAI models.",
    default: 3000,
    envKey: "OPENAI_MAX_TOKENS",
    min: 256,
    max: 16000,
    unit: "tokens",
  },
  {
    key: "claude_max_tokens",
    group: "generation",
    type: "int",
    label: "Claude max output tokens",
    description: "Maximum response length for Claude models.",
    default: 3000,
    envKey: "CLAUDE_MAX_TOKENS",
    min: 256,
    max: 16000,
    unit: "tokens",
  },
  {
    key: "gemini_max_output_tokens",
    group: "generation",
    type: "int",
    label: "Gemini max output tokens",
    description: "Maximum response length for Gemini models.",
    default: 3000,
    envKey: "GEMINI_MAX_OUTPUT_TOKENS",
    min: 256,
    max: 16000,
    unit: "tokens",
  },
  {
    key: "chat_history_limit",
    group: "generation",
    type: "int",
    label: "Chat history depth",
    description:
      "How many previous messages of a conversation are sent as context on each turn.",
    default: 12,
    envKey: "AI_CHAT_HISTORY_LIMIT",
    min: 0,
    max: 50,
    unit: "messages",
  },

  // --- tools ----------------------------------------------------------------
  {
    key: "tool_max_rounds",
    group: "tools",
    type: "int",
    label: "Tool-calling max rounds",
    description:
      "How many rounds of data-fetching the model may run before it must answer. Higher allows deeper multi-step questions.",
    default: 8,
    envKey: "AI_TOOL_MAX_ROUNDS",
    min: 1,
    max: 15,
  },
  {
    key: "tool_max_calls_per_round",
    group: "tools",
    type: "int",
    label: "Tool calls per round",
    description: "How many data queries the model may issue in a single round.",
    default: 3,
    envKey: "AI_TOOL_MAX_CALLS_PER_ROUND",
    min: 1,
    max: 6,
  },

  // --- quota ----------------------------------------------------------------
  {
    key: "message_limit_monthly",
    group: "quota",
    type: "int",
    label: "Monthly message limit",
    description:
      "Org-wide cap on assistant messages per calendar month. Applied to new monthly windows.",
    default: 5000,
    envKey: "AI_MESSAGE_LIMIT_MONTHLY",
    min: 0,
    max: 10_000_000,
    unit: "messages",
  },
  {
    key: "token_limit_monthly",
    group: "quota",
    type: "int",
    label: "Monthly token limit",
    description:
      "Org-wide cap on total tokens per calendar month. Applied to new monthly windows.",
    default: 5_000_000,
    envKey: "AI_TOKEN_LIMIT_MONTHLY",
    min: 0,
    max: 10_000_000_000,
    unit: "tokens",
  },
  {
    key: "soft_reserved_tokens",
    group: "quota",
    type: "int",
    label: "Soft reserved tokens",
    description:
      "Tokens provisionally held per in-flight request to avoid overshooting the monthly cap.",
    default: 2000,
    envKey: "AI_SOFT_RESERVED_TOKENS",
    min: 0,
    max: 100_000,
    unit: "tokens",
  },

  // --- advanced -------------------------------------------------------------
  {
    key: "gemini_api_version",
    group: "advanced",
    type: "enum",
    label: "Gemini API version",
    description: "Google Generative AI API version used for Gemini calls.",
    default: "v1beta",
    envKey: "GEMINI_API_VERSION",
    enumValues: ["v1", "v1beta", "v1alpha"],
  },
];

const CATALOG_BY_KEY = new Map<string, AiSettingDefinition>(
  AI_SETTINGS_CATALOG.map((def) => [def.key, def]),
);

const DEFAULT_CACHE_TTL_MS = 30_000;

export class AiSettingsService {
  private static snapshot: Map<string, string> | null = null;
  private static loadedAt = 0;
  private static inflight: Promise<Map<string, string>> | null = null;

  private get ttlMs(): number {
    const parsed = Number(process.env.AI_SETTINGS_CACHE_TTL_MS);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Populate the in-memory snapshot of DB-stored settings. Call once at the
   * start of any flow that reads settings synchronously (e.g. a chat turn).
   * Safe to call repeatedly: it no-ops while the cache is warm and collapses
   * concurrent loads.
   */
  async ensureLoaded(): Promise<void> {
    const fresh =
      AiSettingsService.snapshot !== null &&
      Date.now() - AiSettingsService.loadedAt < this.ttlMs;
    if (fresh) return;

    if (!AiSettingsService.inflight) {
      AiSettingsService.inflight = this.loadSnapshot().finally(() => {
        AiSettingsService.inflight = null;
      });
    }

    const snapshot = await AiSettingsService.inflight;
    AiSettingsService.snapshot = snapshot;
    AiSettingsService.loadedAt = Date.now();
  }

  private async loadSnapshot(): Promise<Map<string, string>> {
    try {
      const rows = await prisma.ai_setting.findMany({
        select: { key: true, value: true },
      });
      return new Map(rows.map((row) => [row.key, row.value]));
    } catch (error) {
      // Degrade to env/defaults rather than breaking a chat turn if the table
      // is unavailable (e.g. migration not yet applied).
      return new Map();
    }
  }

  /** Drop the cache so the next read reflects a just-saved change. */
  static invalidate(): void {
    AiSettingsService.snapshot = null;
    AiSettingsService.loadedAt = 0;
  }

  private rawValue(key: string): string | undefined {
    const fromDb = AiSettingsService.snapshot?.get(key);
    if (fromDb !== undefined && fromDb !== null && String(fromDb).trim() !== "") {
      return String(fromDb);
    }
    const def = CATALOG_BY_KEY.get(key);
    if (def?.envKey) {
      const fromEnv = process.env[def.envKey];
      if (fromEnv !== undefined && String(fromEnv).trim() !== "") {
        return String(fromEnv);
      }
    }
    return undefined;
  }

  private clamp(value: number, def: AiSettingDefinition): number {
    let out = value;
    if (typeof def.min === "number") out = Math.max(def.min, out);
    if (typeof def.max === "number") out = Math.min(def.max, out);
    return out;
  }

  getInt(key: string): number {
    const def = CATALOG_BY_KEY.get(key);
    const fallback = Number(def?.default ?? 0);
    const raw = this.rawValue(key);
    const parsed = raw === undefined ? fallback : Number(raw);
    const safe = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
    return def ? this.clamp(safe, def) : safe;
  }

  getFloat(key: string): number {
    const def = CATALOG_BY_KEY.get(key);
    const fallback = Number(def?.default ?? 0);
    const raw = this.rawValue(key);
    const parsed = raw === undefined ? fallback : Number(raw);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return def ? this.clamp(safe, def) : safe;
  }

  getString(key: string): string {
    const def = CATALOG_BY_KEY.get(key);
    const fallback = String(def?.default ?? "");
    const raw = this.rawValue(key);
    const value = raw === undefined ? fallback : raw;
    if (def?.type === "enum" && def.enumValues && !def.enumValues.includes(value)) {
      return fallback;
    }
    return value;
  }

  /** Resolved current values + metadata for the console UI. */
  async getAllForConsole(): Promise<AiResolvedSetting[]> {
    await this.ensureLoaded();
    return AI_SETTINGS_CATALOG.map((def) => {
      const hasDb =
        AiSettingsService.snapshot?.get(def.key) !== undefined &&
        String(AiSettingsService.snapshot?.get(def.key) ?? "").trim() !== "";
      const hasEnv =
        def.envKey !== undefined &&
        process.env[def.envKey] !== undefined &&
        String(process.env[def.envKey]).trim() !== "";
      const source: AiResolvedSetting["source"] = hasDb
        ? "db"
        : hasEnv
          ? "env"
          : "default";

      const value =
        def.type === "float"
          ? this.getFloat(def.key)
          : def.type === "int"
            ? this.getInt(def.key)
            : this.getString(def.key);

      return {
        key: def.key,
        group: def.group,
        type: def.type,
        label: def.label,
        description: def.description,
        value,
        default: def.default,
        source,
        min: def.min,
        max: def.max,
        step: def.step,
        enumValues: def.enumValues,
        unit: def.unit,
      };
    });
  }

  private coerceAndValidate(
    def: AiSettingDefinition,
    rawInput: unknown,
  ): string {
    if (def.type === "int" || def.type === "float") {
      const num = Number(rawInput);
      if (!Number.isFinite(num)) {
        throw new AiSettingsServiceError(`${def.label} must be a number`);
      }
      const value = def.type === "int" ? Math.floor(num) : num;
      if (typeof def.min === "number" && value < def.min) {
        throw new AiSettingsServiceError(`${def.label} must be >= ${def.min}`);
      }
      if (typeof def.max === "number" && value > def.max) {
        throw new AiSettingsServiceError(`${def.label} must be <= ${def.max}`);
      }
      return String(value);
    }

    const str = String(rawInput ?? "").trim();
    if (!str) {
      throw new AiSettingsServiceError(`${def.label} cannot be empty`);
    }
    if (str.length > 191) {
      throw new AiSettingsServiceError(`${def.label} is too long`);
    }
    if (def.type === "enum" && def.enumValues && !def.enumValues.includes(str)) {
      throw new AiSettingsServiceError(
        `${def.label} must be one of: ${def.enumValues.join(", ")}`,
      );
    }
    return str;
  }

  /**
   * Upsert one or more settings. Unknown keys are rejected. `null`/`undefined`
   * for a key resets it to env/default by deleting the DB row.
   */
  async updateMany(
    actorId: number,
    patch: Record<string, unknown>,
  ): Promise<AiResolvedSetting[]> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new AiSettingsServiceError("A settings object is required");
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      throw new AiSettingsServiceError("No settings provided");
    }

    const upserts: { key: string; value: string }[] = [];
    const resets: string[] = [];

    for (const key of keys) {
      const def = CATALOG_BY_KEY.get(key);
      if (!def) {
        throw new AiSettingsServiceError(`Unknown setting: ${key}`);
      }
      const input = patch[key];
      if (input === null || input === undefined) {
        resets.push(key);
        continue;
      }
      upserts.push({ key, value: this.coerceAndValidate(def, input) });
    }

    await prisma.$transaction(async (tx) => {
      for (const { key, value } of upserts) {
        await tx.ai_setting.upsert({
          where: { key },
          create: { key, value, updated_by: actorId },
          update: { value, updated_by: actorId },
        });
      }
      if (resets.length > 0) {
        await tx.ai_setting.deleteMany({ where: { key: { in: resets } } });
      }
    });

    AiSettingsService.invalidate();
    return this.getAllForConsole();
  }
}
