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

// ── Language Detection ───────────────────────────────────────────

/**
 * Detect the primary language of user input using Unicode script heuristics.
 * Returns a BCP-47 language tag (e.g. "ja", "ko", "zh", "en").
 *
 * This is intentionally lightweight — no external NLP dependency.
 * The returned tag is used to instruct agents to match the user's language.
 */
export function detectLanguage(text: string): string {
  // Count characters in CJK / Hangul / Latin ranges
  let ja = 0; // Hiragana + Katakana
  let cjk = 0; // CJK Unified Ideographs (shared by ja/zh)
  let ko = 0; // Hangul
  let latin = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) {
      ja++;
    } else if (cp >= 0x4e00 && cp <= 0x9fff) {
      cjk++;
    } else if (cp >= 0xac00 && cp <= 0xd7af) {
      ko++;
    } else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
      latin++;
    }
  }

  // Japanese: any hiragana/katakana found, or CJK with no Korean
  if (ja > 0) return "ja";
  if (ko > 0) return "ko";
  // Pure CJK without kana → treat as Chinese
  if (cjk > 0 && ja === 0) return "zh";
  return "en";
}

/** Map BCP-47 tags to human-readable language names (used in prompts). */
export const LANGUAGE_NAMES: Record<string, string> = {
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  zh: "Chinese (中文)",
  en: "English",
};

/** Get a display name for a language tag, falling back to the tag itself. */
export function languageDisplayName(tag: string): string {
  return LANGUAGE_NAMES[tag] ?? tag;
}
