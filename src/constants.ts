/**
 * Constants — single source of truth for model names and defaults.
 *
 * All model-related literals should reference these constants
 * to avoid scattered hard-coded strings across the codebase.
 */

/** All models available for agent sessions. */
export const AVAILABLE_MODELS = [
  "claude-opus-4.6",
  "claude-sonnet-4.6",
  "gpt-5.3-codex",
  "claude-haiku-3.5",
] as const;

/** Union type of available model names. */
export type ModelName = (typeof AVAILABLE_MODELS)[number];

/** Default model for the Lead agent. */
export const DEFAULT_LEAD_MODEL: ModelName = "claude-opus-4.6";

/** Default model for Teammate agents when the Lead does not specify one. */
export const DEFAULT_TEAMMATE_MODEL: ModelName = "claude-sonnet-4.6";

/** Human-readable descriptions of each model's strengths. */
export const MODEL_DESCRIPTIONS: Record<ModelName, string> = {
  "claude-opus-4.6": "complex multi-step reasoning, architecture, security",
  "claude-sonnet-4.6": "strong coding, review, testing, analysis (recommended default)",
  "gpt-5.3-codex": "code generation, large-scale refactoring, multi-file edits",
  "claude-haiku-3.5": "docs, formatting, translation, simple/fast tasks",
};
