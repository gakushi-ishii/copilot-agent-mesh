/**
 * Orchestrator — the core engine that manages agents, delivers messages
 * between sessions, and coordinates the team lifecycle.
 *
 * This is the "glue" that makes bidirectional multi-agent communication
 * possible on top of the Copilot SDK's multi-session support.
 */
import { CopilotClient } from "@github/copilot-sdk";
import { MessageBus } from "./message-bus.js";
import { createAgentTools, createLeadTools } from "./agent-tools.js";
import {
  buildSystemMessage,
  type AgentInfo,
  type AgentRole,
  type ManagedAgent,
} from "./agent-session.js";

export interface OrchestratorConfig {
  /** Model to use for the Lead / default (default: "claude-opus-4.6") */
  model?: string;
  /** Polling interval in ms for message delivery (default: 2000) */
  pollIntervalMs?: number;
  /** Enable streaming output (default: true) */
  streaming?: boolean;
  /** Log callback for debug output */
  onLog?: (level: "info" | "debug" | "warn" | "error", msg: string) => void;
}

// ── Role-based Model Selection ─────────────────────────────────────
//
// Maps teammate specialty keywords to the most cost-effective model
// that still meets quality requirements. The Lead always uses the
// configured top-tier model (claude-opus-4.6 by default).

const MODEL_RULES: { match: RegExp; model: string; reason: string }[] = [
  // Heavy reasoning / architecture / complex analysis → top-tier
  { match: /architect|design|plan|strateg/i,          model: "claude-opus-4.6",   reason: "complex reasoning" },
  { match: /security|vulnerabilit|threat|pentest/i,   model: "claude-opus-4.6",   reason: "security-critical analysis" },
  { match: /debug|investigat|root.cause/i,            model: "claude-opus-4.6",   reason: "deep debugging" },

  // Code generation / review / refactoring → strong coding model
  { match: /code|implement|develop|engineer|refactor/i, model: "claude-sonnet-4",  reason: "code generation" },
  { match: /review|audit|quality/i,                     model: "claude-sonnet-4",  reason: "code review" },
  { match: /test|qa|testing/i,                          model: "claude-sonnet-4",  reason: "test authoring" },

  // Writing / documentation / summarisation → fast model
  { match: /writ|document|readme|summar|report/i,       model: "claude-haiku-3.5", reason: "documentation" },
  { match: /format|lint|style|translate/i,               model: "claude-haiku-3.5", reason: "formatting / translation" },

  // Research / data gathering → balanced model
  { match: /research|analys|data|metric|benchmark/i,    model: "claude-sonnet-4",  reason: "analysis & research" },
];

/**
 * Select the best model for a teammate based on its role/specialty.
 * Falls back to the configured default model if no rule matches.
 */
function selectModelForRole(
  role: string,
  defaultModel: string,
  log?: (level: "info" | "debug" | "warn" | "error", msg: string) => void,
): string {
  for (const rule of MODEL_RULES) {
    if (rule.match.test(role)) {
      log?.("info", `Model auto-select: "${role}" → ${rule.model} (${rule.reason})`);
      return rule.model;
    }
  }
  log?.("info", `Model auto-select: "${role}" → ${defaultModel} (default fallback)`);
  return defaultModel;
}

export class Orchestrator {
  private client: CopilotClient;
  private bus: MessageBus;
  private agents = new Map<string, ManagedAgent>();
  private config: Required<OrchestratorConfig>;
  private agentCounter = 0;
  private running = false;

  constructor(config?: OrchestratorConfig) {
    this.config = {
      model: config?.model ?? "claude-opus-4.6",
      pollIntervalMs: config?.pollIntervalMs ?? 2000,
      streaming: config?.streaming ?? true,
      onLog: config?.onLog ?? (() => {}),
    };
    this.client = new CopilotClient();
    this.bus = new MessageBus();
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async start(): Promise<void> {
    this.log("info", "Starting Copilot client...");
    await this.client.start();
    this.running = true;
    this.log("info", "Copilot client started.");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.log("info", "Shutting down all agents...");

    // Stop all polling
    for (const agent of this.agents.values()) {
      if (agent.pollHandle) clearInterval(agent.pollHandle);
    }

    // Destroy all sessions
    const errors: Error[] = [];
    for (const agent of this.agents.values()) {
      try {
        await agent.session.destroy();
      } catch (e: any) {
        errors.push(e);
      }
    }
    this.agents.clear();

    await this.client.stop();
    this.bus.reset();
    this.log("info", `Orchestrator stopped. (${errors.length} cleanup errors)`);
  }

  // ── Agent Management ──────────────────────────────────────────

  /**
   * Create the Lead agent. Must be called first.
   */
  async createLead(model?: string): Promise<ManagedAgent> {
    const id = "lead";
    const info: AgentInfo = { id, name: "Lead", role: "lead" };
    return this.createAgent(info, model);
  }

  /**
   * Spawn a Teammate agent. Called by the Lead via the spawn_teammate tool
   * or programmatically.
   */
  async spawnTeammate(
    name: string,
    role: string,
    initialPrompt: string,
    model?: string,
  ): Promise<ManagedAgent> {
    const id = `teammate-${++this.agentCounter}-${name}`;
    const info: AgentInfo = { id, name, role: "teammate", specialty: role };

    // Auto-select model based on role unless the Lead explicitly chose one
    const selectedModel =
      model ?? selectModelForRole(role, this.config.model, this.config.onLog);

    if (model) {
      this.log("info", `Lead chose model "${model}" for teammate "${name}" (${role})`);
    }

    const agent = await this.createAgent(info, selectedModel);

    // Send the initial prompt to get the teammate working
    this.log("info", `Teammate "${name}" spawned. Sending initial prompt...`);
    await this.sendToAgent(agent, initialPrompt);

    return agent;
  }

  private async createAgent(info: AgentInfo, model?: string): Promise<ManagedAgent> {
    const resolvedModel = model ?? this.config.model;
    info.model = resolvedModel;
    this.bus.registerAgent(info.id);
    const teamSize = this.agents.size + 1;

    // Build tools for this agent
    const baseTools = createAgentTools(info.id, this.bus);
    const tools =
      info.role === "lead"
        ? [
            ...baseTools,
            ...createLeadTools(info.id, this.bus, {
              onSpawnTeammate: async (name, role, prompt, model) => {
                const tm = await this.spawnTeammate(name, role, prompt, model);
                return tm.info.id;
              },
              onShutdownTeammate: async (teammateId) => {
                await this.shutdownAgent(teammateId);
              },
            }),
          ]
        : baseTools;

    const session = await this.client.createSession({
      model: resolvedModel,
      tools,
      systemMessage: {
        content: buildSystemMessage(info, teamSize),
      },
      streaming: this.config.streaming,
    } as any);

    const agent: ManagedAgent = {
      info,
      session,
      busy: false,
    };

    this.agents.set(info.id, agent);

    // Set up streaming output
    session.on("assistant.message_delta", (event: any) => {
      if (this.config.streaming) {
        const prefix = `[${info.name}] `;
        process.stdout.write(
          event.data.deltaContent
            ? prefix + event.data.deltaContent.replace(/\n/g, `\n${prefix}`)
            : "",
        );
      }
    });

    session.on("assistant.message", (event: any) => {
      if (this.config.streaming) {
        process.stdout.write("\n");
      }
      this.log("debug", `[${info.name}] turn complete`);
    });

    // Start message polling for this agent
    this.startMessagePolling(agent);

    this.log("info", `Agent "${info.name}" (${info.id}) created.`);
    return agent;
  }

  private async shutdownAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);
    if (agent.info.role === "lead")
      throw new Error("Cannot shut down the lead agent");

    if (agent.pollHandle) clearInterval(agent.pollHandle);
    await agent.session.destroy();
    this.bus.unregisterAgent(agentId);
    this.agents.delete(agentId);
    this.log("info", `Agent "${agent.info.name}" shut down.`);
  }

  // ── Message Delivery Loop ─────────────────────────────────────

  /**
   * The core bidirectional communication mechanism:
   * Periodically check each agent's mailbox. If there are unread messages,
   * inject them as a new prompt into the agent's session.
   */
  private startMessagePolling(agent: ManagedAgent): void {
    agent.pollHandle = setInterval(async () => {
      if (!this.running || agent.busy) return;

      if (this.bus.hasUnreadMessages(agent.info.id)) {
        const msgs = this.bus.readMessages(agent.info.id);
        if (msgs.length === 0) return;

        const formatted = msgs
          .map(
            (m) =>
              `[Message from ${m.from}]: ${m.content}`,
          )
          .join("\n\n");

        const prompt = `You have ${msgs.length} new message(s) from teammates:\n\n${formatted}\n\nPlease read and respond appropriately. If any action is needed, take it. Then check your task list.`;

        await this.sendToAgent(agent, prompt);
      }
    }, this.config.pollIntervalMs);
  }

  /**
   * Send a prompt to an agent's session, with busy-state tracking.
   */
  private async sendToAgent(agent: ManagedAgent, prompt: string): Promise<void> {
    if (agent.busy) {
      this.log("debug", `[${agent.info.name}] busy, enqueueing message`);
      // Enqueue using the SDK's enqueue mode
      await agent.session.send({ prompt, mode: "enqueue" } as any);
      return;
    }

    agent.busy = true;
    try {
      await agent.session.sendAndWait({ prompt });
    } catch (err: any) {
      this.log("error", `[${agent.info.name}] Error: ${err.message}`);
    } finally {
      agent.busy = false;
    }
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Send a user prompt to the Lead agent and let the team process it.
   */
  async submitTask(prompt: string): Promise<void> {
    const lead = this.agents.get("lead");
    if (!lead) throw new Error("Lead agent not created. Call createLead() first.");

    this.log("info", `Submitting task to lead: "${prompt.slice(0, 80)}..."`);
    await this.sendToAgent(lead, prompt);
  }

  /**
   * Wait until all agents are idle (no busy agents, no pending/in-progress tasks).
   * Useful for synchronous workflows.
   */
  async waitForCompletion(timeoutMs = 300_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const allIdle = [...this.agents.values()].every((a) => !a.busy);
      const pendingTasks = this.bus
        .listTasks()
        .some((t) => t.status === "pending" || t.status === "in-progress");

      if (allIdle && !pendingTasks) {
        this.log("info", "All agents idle, all tasks completed.");
        return;
      }

      await sleep(1000);
    }
    this.log("warn", "Timed out waiting for completion.");
  }

  getAgent(id: string): ManagedAgent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): ManagedAgent[] {
    return [...this.agents.values()];
  }

  getBus(): MessageBus {
    return this.bus;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private log(level: "info" | "debug" | "warn" | "error", msg: string): void {
    this.config.onLog(level, msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
