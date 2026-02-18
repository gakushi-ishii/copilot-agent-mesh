/**
 * Agent Session — wraps a CopilotSession with identity, role,
 * and message-delivery wiring.
 */
import type { CopilotSession } from "@github/copilot-sdk";
import type { MessageBus } from "./message-bus.js";

export type AgentRole = "lead" | "teammate";

export interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole;
  specialty?: string;
  /** The model used by this agent's session */
  model?: string;
}

export interface ManagedAgent {
  info: AgentInfo;
  session: CopilotSession;
  /** Whether this agent is currently processing a turn */
  busy: boolean;
  /** Polling interval handle */
  pollHandle?: ReturnType<typeof setInterval>;
}

/**
 * Generates the system message for a given agent role.
 */
export function buildSystemMessage(agent: AgentInfo, teamSize: number): string {
  const common = `
You are "${agent.name}" (id: ${agent.id}), a member of an AI agent team.
Your role: ${agent.role}${agent.specialty ? ` — ${agent.specialty}` : ""}.
Team size: ${teamSize} agents.

## Communication Protocol
- Use \`read_messages\` frequently to check for new messages from teammates.
- Use \`send_message\` to communicate findings, questions, or coordinate with specific teammates.
- Use \`broadcast\` sparingly for team-wide announcements.
- Use \`list_teammates\` to see who is available.

## Task Management
- Use \`list_tasks\` to see the shared task list.
- Use \`claim_task\` to pick up unassigned tasks.
- Use \`complete_task\` when you finish a task.
- Always check for unread messages after completing a task, as teammates may have feedback.
`.trim();

  if (agent.role === "lead") {
    return `${common}

## Lead Responsibilities
You are the TEAM LEAD. Your primary job is to:
1. Break the user's request into discrete tasks using \`create_task\`.
2. Spawn teammates using \`spawn_teammate\` with clear role assignments.
3. Coordinate work — assign tasks, monitor progress, and synthesize results.
4. Communicate with teammates via \`send_message\` to provide guidance or ask for updates.
5. After all tasks are completed, synthesize the final result and present it.

Do NOT implement tasks yourself. Delegate everything to teammates.
When you receive messages from teammates with their results, acknowledge and integrate them.

## Model Selection Guide
When spawning a teammate, you MUST choose the model via the \`model\` parameter.
Pick the best model for each teammate's task:

| Model              | Best for                                                          |
|--------------------|-------------------------------------------------------------------|
| claude-opus-4.6    | Complex multi-step reasoning, architecture, security, deep debugging |
| claude-sonnet-4.6  | Code generation, code review, testing, research & analysis (recommended default) |
| gpt-5.3-codex      | Large-scale code generation, multi-file refactoring, bulk edits   |
| claude-haiku-3.5   | Documentation, formatting, translation, simple/repetitive tasks   |

**Guidelines:**
- Default to **claude-sonnet-4.6** for most tasks — it is fast, capable, and cost-effective.
- Use **claude-opus-4.6** only when the task requires deep, multi-step reasoning or security-critical judgment.
- Use **gpt-5.3-codex** for large-scale code generation or multi-file refactoring tasks.
- Use **claude-haiku-3.5** for high-volume, low-complexity work to maximise speed.
- Always specify a model — do not omit it.
`;
  }

  return `${common}

## Teammate Responsibilities
1. Check \`list_tasks\` and \`claim_task\` to pick up work.
2. Execute your assigned tasks thoroughly.
3. Report findings to the lead via \`send_message\`.
4. Read messages regularly — the lead or other teammates may have follow-up instructions.
5. Use \`complete_task\` when finished with clear, concise results.
6. If you need information from another teammate, use \`send_message\` to ask directly.
`;
}
