/**
 * Agent Tools — custom tools injected into each CopilotSession
 * so that agents can communicate via the MessageBus using natural
 * tool-call semantics.
 */
import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { MessageBus } from "./message-bus.js";

/** Log callback type for tool activity visibility */
export type ToolLogger = (level: "info" | "debug" | "warn" | "error", msg: string) => void;

/** No-op logger as default */
const noop: ToolLogger = () => {};

/**
 * Creates the set of communication tools for a given agent.
 * Each tool closure captures the agentId and the shared MessageBus.
 */
export function createAgentTools(agentId: string, bus: MessageBus, onLog: ToolLogger = noop) {
  return [
    // ── send_message ──────────────────────────────────────────────
    defineTool("send_message", {
      description:
        "Send a direct message to another teammate. Use this to share findings, ask questions, or coordinate work.",
      parameters: z.object({
        to: z.string().describe("The agent ID to send the message to"),
        content: z.string().describe("The message content"),
      }),
      handler: async ({ to, content }) => {
        onLog("info", `[${agentId}] 📤 send_message → ${to}: ${content.slice(0, 120)}`);
        try {
          const msg = bus.sendMessage(agentId, to, content);
          return { success: true, messageId: msg.id };
        } catch (err: any) {
          onLog("error", `[${agentId}] send_message failed: ${err.message}`);
          return { success: false, error: err.message };
        }
      },
    }),

    // ── broadcast ─────────────────────────────────────────────────
    defineTool("broadcast", {
      description:
        "Broadcast a message to ALL teammates simultaneously. Use sparingly — prefer send_message for targeted communication.",
      parameters: z.object({
        content: z.string().describe("The message to broadcast"),
      }),
      handler: async ({ content }) => {
        onLog("info", `[${agentId}] 📢 broadcast: ${content.slice(0, 120)}`);
        const msg = bus.sendMessage(agentId, "*", content);
        return { success: true, messageId: msg.id };
      },
    }),

    // ── read_messages ─────────────────────────────────────────────
    defineTool("read_messages", {
      description:
        "Read unread messages from your mailbox. Call this periodically to check for new messages from teammates.",
      parameters: z.object({}),
      handler: async () => {
        const msgs = bus.readMessages(agentId);
        onLog("info", `[${agentId}] 📬 read_messages: ${msgs.length} unread`);
        if (msgs.length === 0) {
          return { messages: [], note: "No unread messages." };
        }
        return {
          messages: msgs.map((m) => ({
            from: m.from,
            content: m.content,
            timestamp: new Date(m.timestamp).toISOString(),
          })),
        };
      },
    }),

    // ── create_task ───────────────────────────────────────────────
    defineTool("create_task", {
      description:
        "Create a new task on the shared task list. Optionally assign it to a specific teammate.",
      parameters: z.object({
        description: z.string().describe("What needs to be done"),
        assignee: z
          .string()
          .optional()
          .describe("Agent ID to assign the task to (leave empty for unassigned)"),
        dependsOn: z
          .array(z.string())
          .optional()
          .describe("Task IDs that must complete before this task can start"),
      }),
      handler: async ({ description, assignee, dependsOn }) => {
        onLog("info", `[${agentId}] 📋 create_task: "${description.slice(0, 80)}" → ${assignee ?? "unassigned"}`);
        const task = bus.createTask(description, agentId, {
          assignee,
          dependsOn,
        });
        return { success: true, taskId: task.id };
      },
    }),

    // ── claim_task ────────────────────────────────────────────────
    defineTool("claim_task", {
      description:
        "Claim an unassigned pending task from the shared task list. The task will be assigned to you.",
      parameters: z.object({
        taskId: z.string().describe("The ID of the task to claim"),
      }),
      handler: async ({ taskId }) => {
        onLog("info", `[${agentId}] 🙋 claim_task: ${taskId}`);
        try {
          const task = bus.claimTask(taskId, agentId);
          return { success: true, task: { id: task.id, description: task.description } };
        } catch (err: any) {
          onLog("warn", `[${agentId}] claim_task failed: ${err.message}`);
          return { success: false, error: err.message };
        }
      },
    }),

    // ── complete_task ─────────────────────────────────────────────
    defineTool("complete_task", {
      description:
        "Mark a task you are working on as completed and provide the result.",
      parameters: z.object({
        taskId: z.string().describe("The ID of the task to complete"),
        result: z.string().describe("Summary of what was accomplished"),
      }),
      handler: async ({ taskId, result }) => {
        onLog("info", `[${agentId}] ✅ complete_task: ${taskId} — ${result.slice(0, 120)}`);
        try {
          bus.completeTask(taskId, agentId, result);
          return { success: true };
        } catch (err: any) {
          onLog("error", `[${agentId}] complete_task failed: ${err.message}`);
          return { success: false, error: err.message };
        }
      },
    }),

    // ── list_tasks ────────────────────────────────────────────────
    defineTool("list_tasks", {
      description:
        "View the shared task list to see all tasks and their current status.",
      parameters: z.object({
        status: z
          .enum(["pending", "in-progress", "completed", "failed"])
          .optional()
          .describe("Filter by status"),
      }),
      handler: async ({ status }) => {
        const tasks = bus.listTasks(status ? { status } : undefined);
        onLog("debug", `[${agentId}] list_tasks(${status ?? "all"}): ${tasks.length} tasks`);
        return {
          tasks: tasks.map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            assignee: t.assignee ?? "unassigned",
            result: t.result,
          })),
        };
      },
    }),

    // ── list_teammates ────────────────────────────────────────────
    defineTool("list_teammates", {
      description:
        "List all currently registered teammates so you know who you can communicate with.",
      parameters: z.object({}),
      handler: async () => {
        const agents = bus.getRegisteredAgents().filter((id) => id !== agentId);
        onLog("debug", `[${agentId}] list_teammates: ${agents.join(", ")}`);
        return { teammates: agents, yourId: agentId };
      },
    }),
  ];
}

/**
 * Additional tools only available to the Lead agent.
 */
export function createLeadTools(
  agentId: string,
  bus: MessageBus,
  callbacks: {
    onSpawnTeammate: (name: string, role: string, prompt: string, model?: string) => Promise<string>;
    onShutdownTeammate: (teammateId: string) => Promise<void>;
  },
  onLog: ToolLogger = noop,
) {
  return [
    defineTool("spawn_teammate", {
      description:
        "Spawn a new teammate agent with a specific role and initial instructions. Only the team lead can do this. " +
        "You SHOULD choose the best model for this teammate based on the task complexity. " +
        "If omitted, the system will auto-select based on role keywords.",
      parameters: z.object({
        name: z.string().describe("A short identifier for the teammate (e.g., 'security-reviewer')"),
        role: z.string().describe("The role/specialty of this teammate"),
        prompt: z
          .string()
          .describe("Detailed instructions for what this teammate should work on"),
        model: z
          .enum([
            "claude-opus-4.6",
            "claude-sonnet-4.6",
            "gpt-5.3-codex",
            "claude-haiku-3.5",
          ])
          .optional()
          .describe(
            "Model to use for this teammate. Choose the best fit: " +
            "claude-opus-4.6: complex multi-step reasoning, architecture, security. " +
            "claude-sonnet-4.6: strong coding, review, testing, analysis (recommended default). " +
            "gpt-5.3-codex: code generation, large-scale refactoring, multi-file edits. " +
            "claude-haiku-3.5: docs, formatting, translation, simple/fast tasks. " +
            "If omitted, defaults to claude-sonnet-4.6."
          ),
      }),
      handler: async ({ name, role, prompt, model }) => {
        onLog("info", `[${agentId}] 🚀 spawn_teammate: "${name}" (${role}) [model: ${model ?? "default"}]`);
        try {
          const id = await callbacks.onSpawnTeammate(name, role, prompt, model);
          return { success: true, teammateId: id, model: model ?? "auto-selected" };
        } catch (err: any) {
          onLog("error", `[${agentId}] spawn_teammate failed: ${err.message}`);
          return { success: false, error: err.message };
        }
      },
    }),

    defineTool("shutdown_teammate", {
      description: "Request a teammate to shut down gracefully.",
      parameters: z.object({
        teammateId: z.string().describe("The agent ID of the teammate to shut down"),
      }),
      handler: async ({ teammateId }) => {
        onLog("info", `[${agentId}] 🚫 shutdown_teammate: ${teammateId}`);
        try {
          await callbacks.onShutdownTeammate(teammateId);
          return { success: true };
        } catch (err: any) {
          onLog("error", `[${agentId}] shutdown_teammate failed: ${err.message}`);
          return { success: false, error: err.message };
        }
      },
    }),
  ];
}
