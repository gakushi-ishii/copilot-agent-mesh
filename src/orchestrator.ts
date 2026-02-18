/**
 * Orchestrator — the core engine that manages agents, delivers messages
 * between sessions, and coordinates the team lifecycle.
 *
 * This is the "glue" that makes bidirectional multi-agent communication
 * possible on top of the Copilot SDK's multi-session support.
 */
import { CopilotClient } from "@github/copilot-sdk";
import { MessageBus } from "./message-bus.js";
import { createAgentTools, createLeadTools, type ToolLogger } from "./agent-tools.js";
import {
  buildSystemMessage,
  type AgentInfo,
  type AgentRole,
  type ManagedAgent,
} from "./agent-session.js";
import { TmuxManager } from "./tmux-pane.js";

export interface OrchestratorConfig {
  /** Model to use for the Lead / default (default: "claude-opus-4.6") */
  model?: string;
  /** Polling interval in ms for message delivery (default: 2000) */
  pollIntervalMs?: number;
  /** Enable streaming output (default: true) */
  streaming?: boolean;
  /** Maximum turns per agent before forced stop (default: 20) */
  maxTurnsPerAgent?: number;
  /** Log callback for debug output */
  onLog?: (level: "info" | "debug" | "warn" | "error", msg: string) => void;
}

/** Default model for teammate agents when the Lead does not specify one. */
const DEFAULT_TEAMMATE_MODEL = "claude-sonnet-4.6";

export class Orchestrator {
  private client: CopilotClient;
  private bus: MessageBus;
  private agents = new Map<string, ManagedAgent>();
  private config: Required<OrchestratorConfig>;
  private agentCounter = 0;
  private running = false;
  /** Per-agent turn counter for loop prevention */
  private turnCounts = new Map<string, number>();
  /** tmux pane manager for per-agent output isolation */
  private tmux: TmuxManager;

  constructor(config?: OrchestratorConfig) {
    this.config = {
      model: config?.model ?? "claude-opus-4.6",
      pollIntervalMs: config?.pollIntervalMs ?? 2000,
      streaming: config?.streaming ?? true,
      maxTurnsPerAgent: config?.maxTurnsPerAgent ?? 20,
      onLog: config?.onLog ?? (() => {}),
    };
    this.client = new CopilotClient();
    this.bus = new MessageBus();
    this.tmux = new TmuxManager((level, msg) => this.log(level as any, msg));
  }

  /** Whether tmux multi-pane mode is active */
  get isTmuxMode(): boolean {
    return this.tmux.isAvailable;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async start(): Promise<void> {
    this.log("info", "Starting Copilot client...");
    await this.client.start();
    this.running = true;
    // Set the main pane's tmux title
    if (this.tmux.isAvailable) {
      this.tmux.setMainPaneTitle("@main");
    }
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
    this.turnCounts.clear();

    // Clean up tmux panes
    this.tmux.closeAll();

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

    // Use the model chosen by the Lead, or fall back to the default teammate model
    const selectedModel = model ?? DEFAULT_TEAMMATE_MODEL;
    this.log(
      "info",
      model
        ? `Lead chose model "${model}" for teammate "${name}" (${role})`
        : `Using default teammate model "${selectedModel}" for "${name}" (${role})`,
    );

    const agent = await this.createAgent(info, selectedModel);

    // Fire-and-forget: send the initial prompt without blocking the caller.
    // This prevents the Lead's sendAndWait timeout from including the
    // teammate's entire processing time.
    this.log("info", `Teammate "${name}" spawned. Sending initial prompt (async)...`);
    this.sendToAgent(agent, initialPrompt).catch((err) => {
      this.log("error", `[${info.name}] initial prompt failed: ${err.message}`);
    });

    return agent;
  }

  private async createAgent(info: AgentInfo, model?: string): Promise<ManagedAgent> {
    const resolvedModel = model ?? this.config.model;
    info.model = resolvedModel;
    this.bus.registerAgent(info.id);
    this.turnCounts.set(info.id, 0);
    const teamSize = this.agents.size + 1;

    // Build tools for this agent, passing the logger for visibility
    const toolLogger: ToolLogger = (level, msg) => this.log(level, msg);
    const baseTools = createAgentTools(info.id, this.bus, toolLogger);
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
            }, toolLogger),
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

    // Create a tmux pane for ALL agents (including lead) when tmux is available.
    // The main pane stays clean and interactive — only structured notifications.
    if (this.tmux.isAvailable) {
      this.tmux.createPane(info.id, info.name, info.specialty ?? info.role);
    }

    // Set up streaming output — route everything to tmux panes when available
    const hasTmuxPane = this.tmux.hasPane(info.id);
    let atLineStart = true;
    const prefix = `\x1b[35m[${info.name}]\x1b[0m `;

    session.on("assistant.message_delta", (event: any) => {
      if (this.config.streaming) {
        const delta =
          event?.data?.deltaContent ??
          event?.delta?.content ??
          event?.content ??
          (typeof event === "string" ? event : "");
        if (delta) {
          if (hasTmuxPane) {
            // Route to dedicated tmux pane — main pane stays clean
            this.tmux.write(info.id, delta);
          } else {
            // Fallback (no tmux): write to stdout with prefix
            let output = "";
            for (const ch of delta) {
              if (atLineStart) {
                output += prefix;
                atLineStart = false;
              }
              output += ch;
              if (ch === "\n") {
                atLineStart = true;
              }
            }
            process.stdout.write(output);
          }
        }
      }
    });

    session.on("assistant.message", () => {
      if (this.config.streaming) {
        if (hasTmuxPane) {
          this.tmux.write(info.id, "\n");
        } else {
          process.stdout.write("\n");
          atLineStart = true;
        }
      }
      this.log("info", `[${info.name}] turn complete`);
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
    this.turnCounts.delete(agentId);
    // Close the tmux pane if it exists
    if (this.tmux.hasPane(agentId)) {
      this.tmux.closePane(agentId);
    }
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

      // Check turn limit
      const turns = this.turnCounts.get(agent.info.id) ?? 0;
      if (turns >= this.config.maxTurnsPerAgent) {
        this.log(
          "warn",
          `[${agent.info.name}] reached max turns (${this.config.maxTurnsPerAgent}), skipping further messages`,
        );
        return;
      }

      if (this.bus.hasUnreadMessages(agent.info.id)) {
        const msgs = this.bus.readMessages(agent.info.id);
        if (msgs.length === 0) return;

        // Log each delivered message for visibility
        for (const m of msgs) {
          this.log(
            "info",
            `📨 Delivering message to [${agent.info.name}] from [${m.from}]: ${m.content.slice(0, 100)}`,
          );
        }

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
    // Check turn limit
    const turns = this.turnCounts.get(agent.info.id) ?? 0;
    if (turns >= this.config.maxTurnsPerAgent) {
      this.log(
        "warn",
        `[${agent.info.name}] max turns (${this.config.maxTurnsPerAgent}) reached — message dropped`,
      );
      return;
    }

    if (agent.busy) {
      this.log("info", `[${agent.info.name}] busy, enqueueing message`);
      // Enqueue using the SDK's enqueue mode
      await agent.session.send({ prompt, mode: "enqueue" } as any);
      return;
    }

    this.turnCounts.set(agent.info.id, turns + 1);
    this.log(
      "info",
      `[${agent.info.name}] ▶ turn ${turns + 1}/${this.config.maxTurnsPerAgent}: ${prompt.slice(0, 100)}...`,
    );

    agent.busy = true;
    // Update tmux pane title to show BUSY state
    if (this.tmux.hasPane(agent.info.id)) {
      this.tmux.updatePaneTitle(agent.info.id, "⏳");
      this.tmux.writeStatus(agent.info.id, "working", `turn ${turns + 1}`);
    }
    try {
      await agent.session.sendAndWait({ prompt });
    } catch (err: any) {
      this.log("error", `[${agent.info.name}] Error: ${err.message}`);
      if (this.tmux.hasPane(agent.info.id)) {
        this.tmux.writeStatus(agent.info.id, "idle", err.message);
      }
    } finally {
      agent.busy = false;
      // Update tmux pane title back to idle
      if (this.tmux.hasPane(agent.info.id)) {
        this.tmux.updatePaneTitle(agent.info.id);
        this.tmux.writeStatus(agent.info.id, "idle");
      }
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
