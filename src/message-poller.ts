/**
 * MessagePoller — periodically checks each agent's mailbox and delivers
 * unread messages as new prompts.
 *
 * Extracted from Orchestrator to separate the polling concern from
 * agent lifecycle management (ar-1).
 *
 * Design invariant: the poller never decides whether a message can be
 * delivered (busy-state, turn-limit, etc.).  Its sole job is to
 * *detect* unread messages and forward them to the `sendToAgent`
 * callback, which is the single authority on delivery policy.
 */
import type { MessageBus } from "./message-bus.js";
import type { ManagedAgent } from "./agent-session.js";

export type LogFn = (level: "info" | "debug" | "warn" | "error", msg: string) => void;

/**
 * Callback invoked when messages need to be delivered to an agent.
 * The caller (Orchestrator) is responsible for the actual send logic.
 */
export type SendToAgentFn = (agent: ManagedAgent, prompt: string) => Promise<void>;

export interface MessagePollerConfig {
  /** Polling interval in ms (default: 2000) */
  pollIntervalMs: number;
  /** Log callback */
  log: LogFn;
}

export class MessagePoller {
  /** Per-agent polling interval handles */
  private pollHandles = new Map<string, ReturnType<typeof setInterval>>();
  private running = true;

  constructor(
    private readonly bus: MessageBus,
    private readonly config: MessagePollerConfig,
    private readonly sendToAgent: SendToAgentFn,
  ) {}

  /**
   * Start polling for a specific agent. Messages found in the agent's
   * mailbox are formatted and delivered via the sendToAgent callback.
   */
  startPolling(agent: ManagedAgent): void {
    const handle = setInterval(async () => {
      if (!this.running) return;

      if (this.bus.hasUnreadMessages(agent.info.id)) {
        const msgs = this.bus.readMessages(agent.info.id);
        if (msgs.length === 0) return;

        // Log each delivered message for visibility
        for (const m of msgs) {
          this.config.log(
            "info",
            `📨 Delivering message to [${agent.info.name}] from [${m.from}]: ${m.content.slice(0, 100)}`,
          );
        }

        const formatted = msgs
          .map((m) => `[Message from ${m.from}]: ${m.content}`)
          .join("\n\n");

        const prompt = `You have ${msgs.length} new message(s) from teammates:\n\n${formatted}\n\nPlease read and respond appropriately. If any action is needed, take it. Then check your task list.`;

        try {
          await this.sendToAgent(agent, prompt);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.config.log("error", `[${agent.info.name}] message delivery failed: ${message}`);
        }
      }
    }, this.config.pollIntervalMs);

    this.pollHandles.set(agent.info.id, handle);
  }

  /** Stop polling for a specific agent. */
  stopPolling(agentId: string): void {
    const handle = this.pollHandles.get(agentId);
    if (handle) {
      clearInterval(handle);
      this.pollHandles.delete(agentId);
    }
  }

  /** Stop all polling loops. */
  stopAll(): void {
    this.running = false;
    for (const handle of this.pollHandles.values()) {
      clearInterval(handle);
    }
    this.pollHandles.clear();
  }
}
