/**
 * tmux-pane.ts — Manages tmux panes for per-agent output isolation.
 *
 * Inspired by Claude Code Agent Teams: each agent runs in its own
 * tmux pane so that the main pane stays interactive and clean.
 *
 * When tmux is not available, falls back to no-op (single-pane mode).
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentPane {
  paneId: string;
  agentId: string;
  agentName: string;
  role: string;
  logFile: string;
  writeStream: fs.WriteStream;
}

// ── Color palette for agent roles ──────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  lead: "\\e[32m",       // green
  reviewer: "\\e[36m",   // cyan
  coder: "\\e[33m",      // yellow
  researcher: "\\e[34m", // blue
  tester: "\\e[35m",     // magenta
  default: "\\e[35m",    // magenta
};

function roleColor(role: string): string {
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (role.toLowerCase().includes(key)) return color;
  }
  return ROLE_COLORS.default;
}

// ── TmuxManager ────────────────────────────────────────────────────

export class TmuxManager {
  private panes = new Map<string, AgentPane>();
  private _available: boolean;
  private tmpDir: string;
  private onLog: (level: string, msg: string) => void;

  constructor(onLog?: (level: string, msg: string) => void) {
    this.onLog = onLog ?? (() => {});
    this._available = this.detectTmux();
    this.tmpDir = path.join(os.tmpdir(), `copilot-agent-teams-${process.pid}`);
    if (this._available) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
      this.onLog("info", `tmux detected — multi-pane mode enabled (tmp: ${this.tmpDir})`);
    } else {
      this.onLog("info", "tmux not detected — single-pane fallback mode");
    }
  }

  /** Whether tmux is available and we are inside a tmux session. */
  get isAvailable(): boolean {
    return this._available;
  }

  // ── Pane Lifecycle ────────────────────────────────────────────

  /**
   * Create a new tmux pane for an agent.
   * The pane runs `tail -f` on a log file; agent output is
   * written to the file and appears in the pane in real-time.
   */
  createPane(agentId: string, agentName: string, role: string): AgentPane | null {
    if (!this._available) return null;

    try {
      const logFile = path.join(this.tmpDir, `${agentId}.log`);

      // Write a banner header into the log file
      const color = roleColor(role);
      const banner = [
        `\x1b[1m${this.ansiColor(role)}`,
        `╔═══════════════════════════════════════════════╗`,
        `║  @${agentName}  (${role})`,
        `╚═══════════════════════════════════════════════╝`,
        `\x1b[0m`,
        ``,
      ].join("\n");
      fs.writeFileSync(logFile, banner);

      // Split window horizontally, run tail -f
      const escapedPath = logFile.replace(/'/g, "'\\''");
      const paneId = execSync(
        `tmux split-window -h -d -P -F "#{pane_id}" "tail -n +1 -f '${escapedPath}'"`,
        { encoding: "utf-8" },
      ).trim();

      // Set the pane border title (tmux ≥ 2.6)
      try {
        execSync(
          `tmux select-pane -t ${paneId} -T "@${agentName}"`,
          { stdio: "pipe" },
        );
      } catch {
        // Older tmux versions may not support -T
      }

      // Re-layout to tile all panes evenly
      execSync(`tmux select-layout tiled`, { stdio: "pipe" });

      const writeStream = fs.createWriteStream(logFile, { flags: "a" });

      const pane: AgentPane = {
        paneId,
        agentId,
        agentName,
        role,
        logFile,
        writeStream,
      };

      this.panes.set(agentId, pane);
      this.updateStatusBar();
      this.onLog("info", `Created tmux pane ${paneId} for @${agentName}`);
      return pane;
    } catch (err: any) {
      this.onLog("error", `Failed to create tmux pane for ${agentId}: ${err.message}`);
      return null;
    }
  }

  // ── Output ────────────────────────────────────────────────────

  /** Write streaming text to an agent's pane. */
  write(agentId: string, text: string): void {
    const pane = this.panes.get(agentId);
    if (!pane) return;
    pane.writeStream.write(text);
  }

  /** Write a full line with the agent prefix. */
  writeLine(agentId: string, line: string): void {
    this.write(agentId, line + "\n");
  }

  // ── Pane Query ────────────────────────────────────────────────

  hasPane(agentId: string): boolean {
    return this.panes.has(agentId);
  }

  getPane(agentId: string): AgentPane | undefined {
    return this.panes.get(agentId);
  }

  getAllPanes(): AgentPane[] {
    return [...this.panes.values()];
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /** Close a specific agent's pane. */
  closePane(agentId: string): void {
    const pane = this.panes.get(agentId);
    if (!pane) return;

    pane.writeStream.end();
    try {
      execSync(`tmux kill-pane -t ${pane.paneId}`, { stdio: "pipe" });
    } catch {
      // Pane may already be closed
    }
    try {
      fs.unlinkSync(pane.logFile);
    } catch {}

    this.panes.delete(agentId);
    this.updateStatusBar();
    this.onLog("info", `Closed tmux pane for @${pane.agentName}`);
  }

  /** Close all agent panes and remove temp dir. */
  closeAll(): void {
    for (const id of [...this.panes.keys()]) {
      this.closePane(id);
    }
    try {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    } catch {}
  }

  // ── Status Bar ────────────────────────────────────────────────

  /** Update tmux status-right to show active agents. */
  private updateStatusBar(): void {
    if (!this._available) return;

    const agents = [...this.panes.values()]
      .map((p) => `@${p.agentName}`)
      .join(" ");
    const count = this.panes.size;
    const status = count > 0
      ? ` @main ${agents} │ ${count} teammate(s) `
      : " @main │ 0 teammates ";

    try {
      execSync(
        `tmux set-option -q status-right "${status}"`,
        { stdio: "pipe" },
      );
    } catch {}
  }

  // ── Helpers ───────────────────────────────────────────────────

  private ansiColor(role: string): string {
    for (const [key, _] of Object.entries(ROLE_COLORS)) {
      if (role.toLowerCase().includes(key)) {
        // Convert escape notation to real ANSI for fs.writeFileSync
        switch (key) {
          case "lead": return "\x1b[32m";
          case "reviewer": return "\x1b[36m";
          case "coder": return "\x1b[33m";
          case "researcher": return "\x1b[34m";
          case "tester": return "\x1b[35m";
        }
      }
    }
    return "\x1b[35m";
  }

  private detectTmux(): boolean {
    try {
      execSync("which tmux", { stdio: "pipe" });
      return !!process.env.TMUX;
    } catch {
      return false;
    }
  }
}
