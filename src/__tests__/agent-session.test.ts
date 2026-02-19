/**
 * agent-session — unit tests for buildSystemMessage
 */
import { describe, it, expect } from "vitest";
import { buildSystemMessage, type AgentInfo } from "../agent-session.js";

describe("buildSystemMessage", () => {
  it("should include agent name and id", () => {
    const agent: AgentInfo = { id: "lead", name: "Lead", role: "lead" };
    const msg = buildSystemMessage(agent, 3);
    expect(msg).toContain('"Lead"');
    expect(msg).toContain("id: lead");
  });

  it("should include team size", () => {
    const agent: AgentInfo = { id: "lead", name: "Lead", role: "lead" };
    const msg = buildSystemMessage(agent, 5);
    expect(msg).toContain("Team size: 5 agents");
  });

  it("should include specialty for teammates", () => {
    const agent: AgentInfo = {
      id: "tm-1",
      name: "Reviewer",
      role: "teammate",
      specialty: "code-review",
    };
    const msg = buildSystemMessage(agent, 2);
    expect(msg).toContain("code-review");
  });

  it("should include lead responsibilities for lead role", () => {
    const agent: AgentInfo = { id: "lead", name: "Lead", role: "lead" };
    const msg = buildSystemMessage(agent, 1);
    expect(msg).toContain("TEAM LEAD");
    expect(msg).toContain("DELEGATION");
    expect(msg).toContain("spawn_teammate");
  });

  it("should include teammate responsibilities for teammate role", () => {
    const agent: AgentInfo = { id: "tm-1", name: "Worker", role: "teammate" };
    const msg = buildSystemMessage(agent, 2);
    expect(msg).toContain("Teammate Responsibilities");
    expect(msg).toContain("claim_task");
  });

  it("should not include lead-specific sections for teammate", () => {
    const agent: AgentInfo = { id: "tm-1", name: "Worker", role: "teammate" };
    const msg = buildSystemMessage(agent, 2);
    expect(msg).not.toContain("MANDATORY");
    expect(msg).not.toContain("spawn_teammate");
  });

  it("should include communication protocol for both roles", () => {
    const lead: AgentInfo = { id: "lead", name: "Lead", role: "lead" };
    const teammate: AgentInfo = { id: "tm-1", name: "Worker", role: "teammate" };
    expect(buildSystemMessage(lead, 2)).toContain("Communication Protocol");
    expect(buildSystemMessage(teammate, 2)).toContain("Communication Protocol");
  });

  it("should include model selection guide for lead", () => {
    const agent: AgentInfo = { id: "lead", name: "Lead", role: "lead" };
    const msg = buildSystemMessage(agent, 1);
    expect(msg).toContain("Model Selection Guide");
    expect(msg).toContain("claude-opus-4.6");
    expect(msg).toContain("claude-sonnet-4.6");
  });
});
