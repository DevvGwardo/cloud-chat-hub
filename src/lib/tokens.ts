/**
 * Simple token estimator (~4 chars per token for English text).
 * Not exact, but good enough for context window progress bars.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough heuristic: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: { role: string; content: string }[]): number {
  return messages.reduce((sum, m) => {
    // Each message has ~4 tokens overhead (role, formatting)
    return sum + 4 + estimateTokens(m.content);
  }, 3); // 3 tokens for chat format priming
}

export function getContextUsage(
  messages: { role: string; content: string }[],
  model: string,
  realUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
) {
  const total = getModelContextWindow(model);
  const used = realUsage
    ? realUsage.totalTokens
    : messages.length > 0
      ? estimateMessagesTokens(messages)
      : 0;
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return { used, total, percentage };
}

/**
 * Context window sizes (in tokens) per model.
 * Falls back to provider-level defaults when model isn't listed.
 */
const MODEL_CONTEXT: Record<string, number> = {
  // Lovable AI
  'google/gemini-3-flash-preview': 1_000_000,
  'google/gemini-2.5-flash': 1_000_000,
  'google/gemini-2.5-pro': 1_000_000,
  'google/gemini-3.1-pro-preview': 1_000_000,
  'openai/gpt-5': 128_000,
  'openai/gpt-5.4': 128_000,
  'openai/gpt-5-mini': 128_000,
  'openai/gpt-5.2': 128_000,

  // OpenAI
  'gpt-5.4': 128_000,
  'gpt-5.2': 128_000,
  'gpt-5.2-codex': 128_000,
  'gpt-5-mini': 128_000,
  'gpt-5-nano': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o3-mini': 200_000,

  // Anthropic
  'claude-sonnet-4-20250514': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,

  // Google Gemini
  'gemini-2.5-pro-preview-06-05': 1_000_000,
  'gemini-2.5-flash-preview-05-20': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-1.5-pro': 2_000_000,

  // xAI
  'grok-3': 131_072,
  'grok-3-mini': 131_072,
  'grok-2': 131_072,

  // Groq
  'llama-3.3-70b-versatile': 128_000,
  'llama-3.1-8b-instant': 131_072,
  'mixtral-8x7b-32768': 32_768,
  'gemma2-9b-it': 8_192,

  // DeepSeek
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,

  // Mistral
  'mistral-large-latest': 128_000,
  'mistral-medium-latest': 32_000,
  'mistral-small-latest': 32_000,
  'open-mistral-nemo': 128_000,

  // Together
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': 128_000,
  'Qwen/Qwen2.5-72B-Instruct-Turbo': 32_768,
  'mistralai/Mixtral-8x22B-Instruct-v0.1': 65_536,
  'deepseek-ai/DeepSeek-V3': 64_000,

  // MiniMax
  'MiniMax-M2.5': 1_000_000,
  'MiniMax-M2.5-highspeed': 1_000_000,
  'MiniMax-M2.1': 1_000_000,
  'MiniMax-M2.1-highspeed': 1_000_000,
  'MiniMax-M2': 200_000,

  // Kimi
  'kimi-k2-0711-preview': 131_072,
  'moonshot-v1-128k': 128_000,
  'moonshot-v1-32k': 32_000,
  'moonshot-v1-8k': 8_000,

  // Cerebras
  'llama-3.3-70b': 128_000,
  'llama-3.1-8b': 128_000,
  'qwen-3-32b': 32_768,

  // OpenRouter
  'deepseek/deepseek-r1:free': 64_000,
  'qwen/qwen3-32b:free': 32_768,
  'meta-llama/llama-4-scout:free': 128_000,
  'google/gemma-3-27b-it:free': 8_192,

  // SambaNova
  'Meta-Llama-3.3-70B-Instruct': 128_000,
  'Qwen2.5-72B-Instruct': 32_768,
  'DeepSeek-R1': 64_000,
};

const DEFAULT_CONTEXT = 128_000;

/**
 * Per-model context-window lookup by model *prefix*, ordered longest-prefix-first.
 * Covers the providers/models listed in `src/lib/providers.ts` (plus the Hermes
 * recommended OpenRouter/direct models). Exact-name entries in MODEL_CONTEXT
 * above always win; this table is the fallback for unknown or newly-rolled
 * model ids (e.g. "gpt-5.3" → gpt-* → 128k).
 */
export const MODEL_CONTEXT_PREFIXES: ReadonlyArray<readonly [prefix: string, window: number]> = [
  // Google Gemini (1M+ windows; gemini-3.x previews also 1M)
  ['google/gemini-', 1_000_000],
  ['gemini-3.1-pro', 1_000_000],
  ['gemini-3.1-flash', 1_000_000],
  ['gemini-2.5', 1_000_000],
  ['gemini-2.0', 1_000_000],
  ['gemini-1.5-pro', 2_000_000],
  ['gemini-1.5', 1_000_000],

  // OpenAI / GPT-5 family + o-series reasoning
  ['openai/gpt-', 128_000],
  ['gpt-', 128_000],
  ['o1-', 200_000],
  ['o1', 200_000],
  ['o3-', 200_000],
  ['o3', 200_000],
  ['o4-', 200_000],
  ['o4', 200_000],

  // Anthropic Claude (200k standard, 1M beta)
  ['anthropic/claude-', 200_000],
  ['claude-', 200_000],

  // xAI Grok
  ['grok-', 131_072],

  // DeepSeek (longest prefix first: v3.x is 128k, plain deepseek-chat is 64k)
  ['deepseek/deepseek-chat-v3', 128_000],
  ['deepseek/deepseek-r1', 64_000],
  ['deepseek/deepseek-v3', 128_000],
  ['deepseek/deepseek-chat', 64_000],
  ['deepseek-chat', 64_000],
  ['deepseek-reasoner', 64_000],
  ['DeepSeek-V3', 64_000],
  ['DeepSeek-R1', 64_000],
  ['deepseek-ai/', 64_000],

  // Mistral
  ['mistral-large', 128_000],
  ['mistral-medium', 32_000],
  ['mistral-small', 32_000],
  ['open-mistral-nemo', 128_000],
  ['mistralai/mixtral', 65_536],
  ['mistralai/mistral-small', 128_000],
  ['mistralai/', 128_000],

  // Meta Llama
  ['meta-llama/llama-4-maverick', 1_000_000],
  ['meta-llama/llama-4-scout', 1_000_000],
  ['meta-llama/llama-3.3', 128_000],
  ['meta-llama/llama-3.1', 131_072],
  ['Meta-Llama-3.3', 128_000],
  ['llama-3.3-70b-versatile', 128_000],
  ['llama-3.1-8b-instant', 131_072],
  ['llama-3.3-70b', 128_000],
  ['llama-3.1-8b', 128_000],
  ['llama-4-', 1_000_000],

  // Qwen
  ['Qwen/Qwen2.5-72B', 32_768],
  ['qwen/qwen3-coder', 128_000],
  ['qwen/qwen3-32b', 32_768],
  ['qwen-3-32b', 32_768],
  ['Qwen2.5-72B', 32_768],
  ['qwen3-next', 128_000],
  ['qwen/', 128_000],

  // OpenAI GPT-OSS (Groq/Cerebras/OpenRouter)
  ['openai/gpt-oss', 128_000],

  // MiniMax
  ['MiniMax-M2.7', 1_000_000],
  ['MiniMax-M2.5', 1_000_000],
  ['MiniMax-M2.1', 1_000_000],
  ['MiniMax-M2', 200_000],

  // Kimi / Moonshot
  ['kimi-k2', 131_072],
  ['kimi-thinking', 131_072],
  ['kimi-for-coding', 131_072],
  ['moonshot-v1-128k', 128_000],
  ['moonshot-v1-32k', 32_000],
  ['moonshot-v1-8k', 8_000],
  ['moonshot-v1', 32_000],

  // z.ai / GLM
  ['glm-5', 128_000],
  ['glm-4', 128_000],

  // Groq free / Cerebras
  ['llama-3.1-', 131_072],

  // Gemma
  ['google/gemma-', 8_192],

  // NVIDIA / others (OpenRouter free tier, default-ish 128k)
  ['nvidia/llama-3.1-nemotron', 131_072],
  ['nousresearch/hermes-3', 131_072],
  ['xiaomi/', 128_000],
  ['anthropic/', 200_000],
];

/**
 * Resolve a model's context window from the prefix table.
 * Longest matching prefix wins; falls back to DEFAULT_CONTEXT (128k).
 */
export function getModelContextWindowByPrefix(model: string): number {
  if (!model) return DEFAULT_CONTEXT;
  const normalized = model.toLowerCase();
  for (const [prefix, window] of MODEL_CONTEXT_PREFIXES) {
    if (normalized.startsWith(prefix.toLowerCase())) {
      return window;
    }
  }
  return DEFAULT_CONTEXT;
}

export function getModelContextWindow(model: string): number {
  return MODEL_CONTEXT[model] ?? getModelContextWindowByPrefix(model);
}

/**
 * Compact token count for meters, e.g. `formatTokens(31400)` → "31.4k",
 * `formatTokens(1_500_000)` → "1.5M". Trailing ".0" is trimmed ("128k").
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) {
    const value = (tokens / 1_000_000).toFixed(1);
    return `${value.replace(/\.0$/, '')}M`;
  }
  if (tokens >= 1_000) {
    const value = (tokens / 1_000).toFixed(1);
    return `${value.replace(/\.0$/, '')}k`;
  }
  return String(Math.round(tokens));
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
