export type AiContext = {
  module?: string;
  scope?: string;
  reference_id?: string;
  [key: string]: unknown;
};

export type AiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type AiUsageSnapshot = {
  message_limit: number;
  message_used: number;
  message_remaining: number;
  token_limit: number;
  token_used: number;
  token_remaining: number;
};

export type AiProviderResult = {
  reply: string;
  provider: string;
  model: string;
  usage: AiUsage;
  fallback_used: boolean;
  fallback_reason?: string;
};

export type AiReservation = {
  period_start: Date;
  period_end: Date;
  reserved_messages: number;
  reserved_tokens: number;
};

export type AiUsageCommitPayload = {
  conversation_id: string;
  message_id: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};
