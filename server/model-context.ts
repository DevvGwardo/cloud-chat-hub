// ─── Per-model context window lookup ─────────────────────────────────────────
// Used to enrich the `usage` event emitted at the end of every chat stream:
// {type:"usage", input_tokens, output_tokens, cached_input_tokens,
//  context_window, model}.
//
// The authoritative table lives in provider-config.ts (CONTEXT_WINDOW_SIZES);
// this module wraps it with the contract default (128k) for unknown models and
// providers so the usage event always carries a number.

import { CONTEXT_WINDOW_SIZES } from './provider-config';

/** Fallback context window when a model is not in the table. */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000;

/**
 * Best-effort per-model context window (in tokens).
 *
 * Resolution order:
 *  1. exact model name in CONTEXT_WINDOW_SIZES
 *  2. short name (strip any `provider/` prefix, e.g. `deepseek/deepseek-v3.2`)
 *  3. DEFAULT_MODEL_CONTEXT_WINDOW (128k)
 */
export function getModelContextWindow(modelName: string): number {
  if (typeof modelName !== 'string' || modelName.trim().length === 0) {
    return DEFAULT_MODEL_CONTEXT_WINDOW;
  }

  if (CONTEXT_WINDOW_SIZES[modelName]) {
    return CONTEXT_WINDOW_SIZES[modelName];
  }

  const shortName = modelName.includes('/') ? modelName.split('/').pop()! : modelName;
  return CONTEXT_WINDOW_SIZES[shortName] ?? DEFAULT_MODEL_CONTEXT_WINDOW;
}
