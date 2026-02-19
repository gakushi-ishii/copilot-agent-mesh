/**
 * constants — unit tests for model constants
 */
import { describe, it, expect } from "vitest";
import {
  AVAILABLE_MODELS,
  DEFAULT_LEAD_MODEL,
  DEFAULT_TEAMMATE_MODEL,
  MODEL_DESCRIPTIONS,
  type ModelName,
} from "../constants.js";

describe("constants", () => {
  describe("AVAILABLE_MODELS", () => {
    it("should contain at least 2 models", () => {
      expect(AVAILABLE_MODELS.length).toBeGreaterThanOrEqual(2);
    });

    it("should include claude-opus-4.6 and claude-sonnet-4.6", () => {
      expect(AVAILABLE_MODELS).toContain("claude-opus-4.6");
      expect(AVAILABLE_MODELS).toContain("claude-sonnet-4.6");
    });

    it("should have no duplicates", () => {
      const unique = new Set(AVAILABLE_MODELS);
      expect(unique.size).toBe(AVAILABLE_MODELS.length);
    });
  });

  describe("DEFAULT_LEAD_MODEL", () => {
    it("should be a valid model name", () => {
      expect(AVAILABLE_MODELS).toContain(DEFAULT_LEAD_MODEL);
    });
  });

  describe("DEFAULT_TEAMMATE_MODEL", () => {
    it("should be a valid model name", () => {
      expect(AVAILABLE_MODELS).toContain(DEFAULT_TEAMMATE_MODEL);
    });

    it("should differ from the lead model", () => {
      expect(DEFAULT_TEAMMATE_MODEL).not.toBe(DEFAULT_LEAD_MODEL);
    });
  });

  describe("MODEL_DESCRIPTIONS", () => {
    it("should have a description for every available model", () => {
      for (const model of AVAILABLE_MODELS) {
        expect(MODEL_DESCRIPTIONS[model as ModelName]).toBeDefined();
        expect(MODEL_DESCRIPTIONS[model as ModelName].length).toBeGreaterThan(0);
      }
    });

    it("should not have extra keys beyond AVAILABLE_MODELS", () => {
      const descKeys = Object.keys(MODEL_DESCRIPTIONS);
      expect(descKeys).toHaveLength(AVAILABLE_MODELS.length);
      for (const key of descKeys) {
        expect(AVAILABLE_MODELS).toContain(key);
      }
    });
  });
});
