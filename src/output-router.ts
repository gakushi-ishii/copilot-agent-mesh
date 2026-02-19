/**
 * OutputRouter — routes agent streaming output to the appropriate sink
 * (tmux pane or stdout with prefix).
 *
 * Extracted from Orchestrator to separate streaming I/O concerns from
 * agent lifecycle management (ar-1).
 *
 * Also exposes an `IOutputSink` interface so callers can depend on the
 * abstraction rather than the concrete TmuxManager (ar-18 prep).
 */
import type { CopilotSession } from "@github/copilot-sdk";
import type { TmuxManager } from "./tmux-pane.js";
import type { AgentInfo } from "./agent-session.js";

export type LogFn = (level: "info" | "debug" | "warn" | "error", msg: string) => void;

/** Status values for agent output channels. */
export type AgentStatus = "thinking" | "idle" | "working" | "done";

// ── IOutputSink — abstraction for per-agent output ────────────────

/** Minimal sink interface for writing agent output. */
export interface IOutputSink {
  /** Whether the sink has a dedicated channel for the given agent. */
  hasChannel(agentId: string): boolean;
  /** Create a channel (pane, tab, etc.) for the agent. */
  createChannel(agentId: string, name: string, role: string, model: string): void;
  /** Write raw text to the agent's channel. */
  write(agentId: string, text: string): void;
  /** Close a specific agent's channel. */
  closeChannel(agentId: string): void;
  /** Close all channels. */
  closeAll(): void;
  /** Update channel title to show status. */
  updateTitle(agentId: string, statusIcon?: string, model?: string): void;
  /** Write a status line to the agent's channel. */
  writeStatus(agentId: string, status: AgentStatus, detail?: string): void;
}

// ── TmuxOutputSink — adapter from TmuxManager to IOutputSink ──────

/** Wraps TmuxManager to satisfy the IOutputSink interface. */
export class TmuxOutputSink implements IOutputSink {
  constructor(private readonly tmux: TmuxManager) {}

  hasChannel(agentId: string): boolean {
    return this.tmux.hasPane(agentId);
  }

  createChannel(agentId: string, name: string, role: string, model: string): void {
    this.tmux.createPane(agentId, name, role, model);
  }

  write(agentId: string, text: string): void {
    this.tmux.write(agentId, text);
  }

  closeChannel(agentId: string): void {
    this.tmux.closePane(agentId);
  }

  closeAll(): void {
    this.tmux.closeAll();
  }

  updateTitle(agentId: string, statusIcon?: string, model?: string): void {
    this.tmux.updatePaneTitle(agentId, statusIcon, model);
  }

  writeStatus(agentId: string, status: AgentStatus, detail?: string): void {
    this.tmux.writeStatus(agentId, status, detail);
  }
}

// ── StdoutOutputSink — fallback when tmux is not available ─────────

/** No-op sink — streaming is handled inline via stdout prefix. */
export class StdoutOutputSink implements IOutputSink {
  hasChannel(_agentId: string): boolean { return false; }
  createChannel(): void { /* no-op */ }
  write(_agentId: string, _text: string): void { /* no-op — handled by attachStreamingListeners */ }
  closeChannel(): void { /* no-op */ }
  closeAll(): void { /* no-op */ }
  updateTitle(): void { /* no-op */ }
  writeStatus(_agentId: string, _status: AgentStatus, _detail?: string): void { /* no-op */ }
}

// ── OutputRouter ──────────────────────────────────────────────────

export class OutputRouter {
  constructor(
    private readonly sink: IOutputSink,
    private readonly streaming: boolean,
    private readonly log: LogFn,
  ) {}

  /** Whether the sink has a dedicated channel for this agent. */
  hasChannel(agentId: string): boolean {
    return this.sink.hasChannel(agentId);
  }

  /** Create a channel (pane) for an agent. */
  createChannel(agentId: string, name: string, role: string, model: string): void {
    this.sink.createChannel(agentId, name, role, model);
  }

  /** Close all channels. */
  closeAll(): void {
    this.sink.closeAll();
  }

  /** Close a specific agent's channel. */
  closeChannel(agentId: string): void {
    this.sink.closeChannel(agentId);
  }

  /** Update a channel title (e.g. to show busy/idle status). */
  updateTitle(agentId: string, statusIcon?: string, model?: string): void {
    if (this.sink.hasChannel(agentId)) {
      this.sink.updateTitle(agentId, statusIcon, model);
    }
  }

  /** Write a status line to the agent's channel. */
  writeStatus(agentId: string, status: AgentStatus, detail?: string): void {
    if (this.sink.hasChannel(agentId)) {
      this.sink.writeStatus(agentId, status, detail);
    }
  }

  /**
   * Attach streaming event listeners to a session, routing deltas
   * to the appropriate output channel.
   */
  attachStreamingListeners(session: CopilotSession, agentInfo: AgentInfo): void {
    const hasDedicatedChannel = this.sink.hasChannel(agentInfo.id);
    let atLineStart = true;
    const prefix = `\x1b[35m[${agentInfo.name}]\x1b[0m `;

    session.on("assistant.message_delta", (event) => {
      if (!this.streaming) return;
      const delta = event.data.deltaContent;
      if (!delta) return;

      if (hasDedicatedChannel) {
        // Route to dedicated channel (tmux pane) — main pane stays clean
        this.sink.write(agentInfo.id, delta);
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
    });

    session.on("assistant.message", () => {
      if (!this.streaming) return;
      if (hasDedicatedChannel) {
        this.sink.write(agentInfo.id, "\n");
      } else {
        process.stdout.write("\n");
        atLineStart = true;
      }
      this.log("info", `[${agentInfo.name}] turn complete`);
    });
  }
}
