/**
 * language — unit tests for language detection and system message integration
 */
import { describe, it, expect } from "vitest";
import { detectLanguage, languageDisplayName, LANGUAGE_NAMES } from "../constants.js";
import { buildSystemMessage, type AgentInfo } from "../agent-session.js";

// ── detectLanguage ────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("should detect Japanese from hiragana/katakana", () => {
    expect(detectLanguage("こんにちは、タスクを実行してください")).toBe("ja");
  });

  it("should detect Japanese even with mixed CJK and kana", () => {
    expect(detectLanguage("日本語のプロンプトでタスクを依頼")).toBe("ja");
  });

  it("should detect Korean from Hangul", () => {
    expect(detectLanguage("안녕하세요 작업을 수행해 주세요")).toBe("ko");
  });

  it("should detect Chinese from pure CJK ideographs (no kana)", () => {
    expect(detectLanguage("请执行这个任务")).toBe("zh");
  });

  it("should default to English for Latin-only text", () => {
    expect(detectLanguage("Please run this task")).toBe("en");
  });

  it("should default to English for empty string", () => {
    expect(detectLanguage("")).toBe("en");
  });

  it("should detect Japanese when kana is present alongside Latin", () => {
    expect(detectLanguage("READMEを日本語で書いてください")).toBe("ja");
  });
});

// ── languageDisplayName ───────────────────────────────────────────

describe("languageDisplayName", () => {
  it("should return display name for known tags", () => {
    expect(languageDisplayName("ja")).toBe("Japanese (日本語)");
    expect(languageDisplayName("en")).toBe("English");
    expect(languageDisplayName("ko")).toBe("Korean (한국어)");
    expect(languageDisplayName("zh")).toBe("Chinese (中文)");
  });

  it("should fall back to the tag for unknown languages", () => {
    expect(languageDisplayName("fr")).toBe("fr");
  });
});

// ── LANGUAGE_NAMES ────────────────────────────────────────────────

describe("LANGUAGE_NAMES", () => {
  it("should include at least ja, ko, zh, en", () => {
    expect(LANGUAGE_NAMES).toHaveProperty("ja");
    expect(LANGUAGE_NAMES).toHaveProperty("ko");
    expect(LANGUAGE_NAMES).toHaveProperty("zh");
    expect(LANGUAGE_NAMES).toHaveProperty("en");
  });
});

// ── buildSystemMessage with language ──────────────────────────────

describe("buildSystemMessage with language", () => {
  const lead: AgentInfo = { id: "lead", name: "Lead", role: "lead" };
  const teammate: AgentInfo = { id: "tm-1", name: "Worker", role: "teammate" };

  it("should include language rule when language is non-English", () => {
    const msg = buildSystemMessage(lead, 2, "ja");
    expect(msg).toContain("LANGUAGE RULE");
    expect(msg).toContain("ja");
  });

  it("should include language rule for teammate when language is non-English", () => {
    const msg = buildSystemMessage(teammate, 2, "ja");
    expect(msg).toContain("LANGUAGE RULE");
  });

  it("should NOT include language rule when language is English", () => {
    const msg = buildSystemMessage(lead, 2, "en");
    expect(msg).not.toContain("LANGUAGE RULE");
  });

  it("should NOT include language rule when language is undefined", () => {
    const msg = buildSystemMessage(lead, 2);
    expect(msg).not.toContain("LANGUAGE RULE");
  });

  it("should still include standard sections even with language set", () => {
    const msg = buildSystemMessage(lead, 2, "ja");
    expect(msg).toContain("TEAM LEAD");
    expect(msg).toContain("Communication Protocol");
    expect(msg).toContain("Model Selection Guide");
  });

  it("should backward-compatible: no language param yields same structure", () => {
    const msg = buildSystemMessage(lead, 2);
    expect(msg).toContain("TEAM LEAD");
    expect(msg).toContain('"Lead"');
  });
});
