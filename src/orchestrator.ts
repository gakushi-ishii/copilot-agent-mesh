/**
 * Orchestrator — the core engine that manages agents, delivers messages
 * between sessions, and coordinates the team lifecycle.
 *
 * This is the "glue" that makes bidirectional multi-agent communication
 * possible on top of the Copilot SDK's multi-session support.
 *
 * Message polling and streaming output routing are handled by
 * dedicated classes (MessagePoller, OutputRouter) injected at
 * construction time (ar-1).
 */
import { CopilotClient } from "@github/copilot-sdk";
import { MessageBus } from "./message-bus.js";
import { createAgentTools, createLeadTools, type ToolLogger } from "./agent-tools.js";
import {
  buildSystemMessage,
  type AgentInfo,
  type ManagedAgent,
} from "./agent-session.js";
import { TmuxManager } from "./tmux-pane.js";
import { DEFAULT_LEAD_MODEL, DEFAULT_TEAMMATE_MODEL, detectLanguage, languageDisplayName } from "./constants.js";
import { MessagePoller } from "./message-poller.js";
import { OutputRouter, TmuxOutputSink, StdoutOutputSink } from "./output-router.js";
import { execFile } from "node:child_process";

/**
 * Verify that the GitHub CLI is authenticated.
 * Throws a descriptive error when `gh auth status` reports a problem.
 */
export async function checkGitHubCliAuth(log: (level: "info" | "debug" | "warn" | "error", msg: string) => void): Promise<void> {
  let result: { stdout: string; stderr: string };
  try {
    result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile("gh", ["auth", "status"], { timeout: 10_000 }, (error, stdout, stderr) => {
        if (error) {
          const err = error as Error & { stderr?: string };
          err.stderr = typeof stderr === "string" ? stderr : "";
          reject(err);
        } else {
          resolve({
            stdout: typeof stdout === "string" ? stdout : String(stdout),
            stderr: typeof stderr === "string" ? stderr : String(stderr),
          });
        }
      });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    log("error", `GitHub CLI authentication check failed: ${message}`);
    if (stderr) {
      log("error", `gh auth status stderr: ${stderr.trim()}`);
    }
    throw new Error(
      `GitHub CLI is not authenticated. Please run 'gh auth login' first.\n` +
      `Detail: ${stderr || message}`,
      { cause: err },
    );
  }

  // gh auth status prints to stderr on success
  const output = (result.stdout + result.stderr).trim();
  if (output.includes("not logged") || output.includes("authentication")) {
    log("debug", `gh auth status output: ${output}`);
  }
  log("info", "GitHub CLI authentication verified.");
}

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s — this often indicates a GitHub CLI authentication problem. Run 'gh auth status' to check.`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface OrchestratorConfig {
  /** Model to use for the Lead / default (default: DEFAULT_LEAD_MODEL) */
  model?: string;
  /** Polling interval in ms for message delivery (default: 2000) */
  pollIntervalMs?: number;
  /** Enable streaming output (default: true) */
  streaming?: boolean;
  /** Maximum turns per agent before forced stop (default: 20) */
  maxTurnsPerAgent?: number;
  /**
   * BCP-47 language tag to enforce across all agents (e.g. "ja", "en").
   * When set to "auto" (default), language is detected from the first
   * user prompt submitted via submitTask().
   */
  language?: string;
  /** Log callback for debug output */
  onLog?: (level: "info" | "debug" | "warn" | "error", msg: string) => void;
}

export class Orchestrator {
  private client: CopilotClient;
  private bus: MessageBus;
  private agents = new Map<string, ManagedAgent>();
  private config: Required<OrchestratorConfig>;
  private agentCounter = 0;
  /** Detected / configured language for the session */
  private language: string | undefined;
  /** @deprecated Dead after DI extraction — use poller.running instead */
  private running = false;
  /** Per-agent turn counter for loop prevention */
  private turnCounts = new Map<string, number>();
  /** tmux pane manager — retained for isTmuxMode check & main pane title */
  private tmux: TmuxManager;
  /** Handles per-agent message polling */
  private poller: MessagePoller;
  /** Routes streaming output to the appropriate sink */
  private router: OutputRouter;

  constructor(config?: OrchestratorConfig) {
    this.config = {
      model: config?.model ?? DEFAULT_LEAD_MODEL,
      pollIntervalMs: config?.pollIntervalMs ?? 2000,
      streaming: config?.streaming ?? true,
      maxTurnsPerAgent: config?.maxTurnsPerAgent ?? 20,
      language: config?.language ?? "auto",
      onLog: config?.onLog ?? (() => {}),
    };
    // Pre-set language if explicitly configured (not "auto")
    if (this.config.language !== "auto") {
      this.language = this.config.language;
    }
    this.client = new CopilotClient();
    this.bus = new MessageBus();
    this.tmux = new TmuxManager((level, msg) => this.log(level, msg));

    // Initialise extracted components via DI
    const logFn = (level: "info" | "debug" | "warn" | "error", msg: string) =>
      this.log(level, msg);

    this.poller = new MessagePoller(
      this.bus,
      {
        pollIntervalMs: this.config.pollIntervalMs,
        log: logFn,
      },
      (agent, prompt) => this.sendToAgent(agent, prompt),
    );

    const sink = this.tmux.isAvailable
      ? new TmuxOutputSink(this.tmux)
      : new StdoutOutputSink();
    this.router = new OutputRouter(sink, this.config.streaming, logFn);
  }

  /** Whether tmux multi-pane mode is active */
  get isTmuxMode(): boolean {
    return this.tmux.isAvailable;
  }

  /** The detected / configured language for the session */
  get sessionLanguage(): string | undefined {
    return this.language;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async start(): Promise<void> {
    // Pre-flight: verify GitHub CLI authentication before touching the SDK
    await checkGitHubCliAuth((level, msg) => this.log(level, msg));

    this.log("info", "Starting Copilot client...");
    try {
      await withTimeout(this.client.start(), 30_000, "CopilotClient.start()");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `Failed to start Copilot client: ${message}`);
      this.log("error", "Hint: Ensure 'gh auth login' has been completed and your token has the 'copilot' scope.");
      throw err;
    }
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
    this.poller.stopAll();

    // Destroy all sessions
    const errors: Error[] = [];
    for (const agent of this.agents.values()) {
      try {
        await agent.session.destroy();
      } catch (e: unknown) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.agents.clear();
    this.turnCounts.clear();

    // Clean up output channels (tmux panes etc.)
    this.router.closeAll();

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

    // Prepend a language enforcement hint when the session language is non-English.
    // This ensures each teammate operates in the user's language even if the
    // Lead accidentally wrote the spawn prompt in English.
    let effectivePrompt = initialPrompt;
    if (this.language && this.language !== "en") {
      effectivePrompt =
        `[SYSTEM] You MUST respond and work entirely in ${languageDisplayName(this.language)}. ` +
        `All output, messages, and task results MUST be in ${languageDisplayName(this.language)}.\n\n` +
        initialPrompt;
    }

    // Fire-and-forget: send the initial prompt without blocking the caller.
    // This prevents the Lead's sendAndWait timeout from including the
    // teammate's entire processing time.
    this.log("info", `Teammate "${name}" spawned. Sending initial prompt (async)...`);
    this.sendToAgent(agent, effectivePrompt).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `[${info.name}] initial prompt failed: ${message}`);
      // Notify the Lead so the task doesn't silently stall
      try {
        this.bus.sendMessage(
          info.id,
          "lead",
          `⚠️ Teammate "${info.name}" failed to initialize: ${message}. The assigned task may need to be reassigned.`,
        );
      } catch {
        // Lead mailbox may not exist if orchestrator is shutting down
        this.log("warn", `[${info.name}] Could not notify lead about initialization failure`);
      }
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

    let session;
    try {
      session = await withTimeout(
        this.client.createSession({
          model: resolvedModel,
          tools,
          systemMessage: {
            content: buildSystemMessage(info, teamSize, this.language),
          },
          streaming: this.config.streaming,
        }),
        30_000,
        `createSession(${info.name})`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `Failed to create session for agent "${info.name}": ${message}`);
      if (message.includes("401") || message.includes("auth") || message.includes("token") || message.includes("timed out")) {
        this.log("error", "This may be a GitHub CLI authentication issue. Run 'gh auth status' to verify.");
      }
      throw err;
    }

    const agent: ManagedAgent = {
      info,
      session,
      busy: false,
    };

    this.agents.set(info.id, agent);

    // Create an output channel for this agent (tmux pane when available)
    if (this.tmux.isAvailable) {
      this.router.createChannel(info.id, info.name, info.specialty ?? info.role, resolvedModel);
    }

    // Attach streaming listeners — delegated to OutputRouter
    this.router.attachStreamingListeners(session, info);

    // Start message polling for this agent — delegated to MessagePoller
    this.poller.startPolling(agent);

    this.log("info", `Agent "${info.name}" (${info.id}) created.`);
    return agent;
  }

  private async shutdownAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);
    if (agent.info.role === "lead")
      throw new Error("Cannot shut down the lead agent");

    this.poller.stopPolling(agentId);
    await agent.session.destroy();
    this.bus.unregisterAgent(agentId);
    this.agents.delete(agentId);
    this.turnCounts.delete(agentId);
    // Close the output channel (tmux pane etc.)
    this.router.closeChannel(agentId);
    this.log("info", `Agent "${agent.info.name}" shut down.`);
  }

  // ── Agent Communication ────────────────────────────────────────

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
      await agent.session.send({ prompt, mode: "enqueue" });
      return;
    }

    this.turnCounts.set(agent.info.id, turns + 1);
    this.log(
      "info",
      `[${agent.info.name}] ▶ turn ${turns + 1}/${this.config.maxTurnsPerAgent}: ${prompt.slice(0, 100)}...`,
    );

    agent.busy = true;
    try {
      // Update output channel title to show BUSY state (inside try to prevent busy-stuck)
      this.router.updateTitle(agent.info.id, "⏳", agent.info.model);
      this.router.writeStatus(agent.info.id, "working", `turn ${turns + 1}`);
      await agent.session.sendAndWait({ prompt });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `[${agent.info.name}] Error: ${message}`);
      if (message.includes("401") || message.includes("auth") || message.includes("token") || message.includes("403")) {
        this.log("error", `[${agent.info.name}] Authentication error detected. Run 'gh auth login' and restart the application.`);
      }
      this.router.writeStatus(agent.info.id, "idle", message);
    } finally {
      agent.busy = false;
      // Update output channel title back to idle
      this.router.updateTitle(agent.info.id, undefined, agent.info.model);
      this.router.writeStatus(agent.info.id, "idle");
    }
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Send a user prompt to the Lead agent and let the team process it.
   */
  async submitTask(prompt: string): Promise<void> {
    const lead = this.agents.get("lead");
    if (!lead) throw new Error("Lead agent not created. Call createLead() first.");

    // Auto-detect language from the first user prompt if not yet set
    if (!this.language && this.config.language === "auto") {
      this.language = detectLanguage(prompt);
      this.log(
        "info",
        `Detected input language: ${languageDisplayName(this.language)} (${this.language})`,
      );
    }

    // Prepend a language enforcement hint to the prompt when the session
    // language is non-English.  Previously this was sent as a separate
    // enqueued message, which caused the Lead to process the hint alone
    // (without any task) and reply with a generic greeting.
    let effectivePrompt = prompt;
    if (this.language && this.language !== "en") {
      const langHint =
        `[SYSTEM] The user is communicating in ${languageDisplayName(this.language)}. ` +
        `You MUST respond, delegate tasks, and communicate with all teammates in the SAME language. ` +
        `All task descriptions, spawn_teammate prompts, and messages MUST be in ${languageDisplayName(this.language)}.\n\n`;
      effectivePrompt = langHint + prompt;
    }

    this.log("info", `Submitting task to lead: "${prompt.slice(0, 80)}..."`);
    await this.sendToAgent(lead, effectivePrompt);
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
