/**
 * CLI entry point — accepts a task from the user, creates the Lead,
 * submits the task, and waits for the team to finish.
 *
 * When running inside tmux, each agent gets its own pane and the
 * main pane stays clean and interactive (Claude Code Agent Teams style).
 */
import { Orchestrator } from "./orchestrator.js";
import {
  renderStatus,
  notifyAgentSpawned,
  notifyTaskCreated,
  notifyTaskCompleted,
} from "./progress-display.js";
import * as readline from "node:readline";
import { DEFAULT_LEAD_MODEL, DEFAULT_TEAMMATE_MODEL, languageDisplayName } from "./constants.js";

// ── Configuration ──────────────────────────────────────────────────

const MODEL = process.env.COPILOT_MODEL ?? DEFAULT_LEAD_MODEL;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000);
const DEBUG = process.argv.includes("--debug") || process.env.LOG_LEVEL === "debug";
const LANGUAGE = process.env.COPILOT_LANGUAGE ?? "auto";

// ── Helpers ────────────────────────────────────────────────────────

/** Whether we are in tmux multi-pane mode (set after orch init) */
let tmuxMode = false;

function log(level: string, msg: string) {
  // Unless --debug is set, suppress all bracket-tagged log lines
  if (!DEBUG) return;

  const ts = new Date().toISOString().slice(11, 19);
  const color =
    level === "error"
      ? "\x1b[31m"
      : level === "warn"
        ? "\x1b[33m"
        : level === "debug"
          ? "\x1b[90m"
          : "\x1b[36m";

  // In tmux mode, suppress noisy info logs in the main pane —
  // only show warnings, errors, and key lifecycle events.
  if (tmuxMode && level === "info") {
    if (
      !msg.includes("spawned") &&
      !msg.includes("shut down") &&
      !msg.includes("Submitting") &&
      !msg.includes("started") &&
      !msg.includes("stopped") &&
      !msg.includes("All agents idle")
    ) {
      return;
    }
  }

  console.error(`${color}[${ts}] [${level.toUpperCase()}]\x1b[0m ${msg}`);
}

// ── Interactive REPL ───────────────────────────────────────────────

async function interactiveMode(orch: Orchestrator) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: "\n\x1b[1m🤖 Task> \x1b[0m",
  });

  // ── Graceful shutdown helper (deduplicated) ─────────────────
  let shuttingDown = false;
  async function gracefulShutdown(reason: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\n\x1b[33mShutting down (${reason})...\x1b[0m`);
    rl.close();
    try {
      await orch.stop();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\x1b[31m[shutdown] cleanup error: ${msg}\x1b[0m`);
    }
    process.exit(0);
  }

  // ── Signal handlers — ensure tmux panes are cleaned up ──────
  process.on("SIGINT", () => { gracefulShutdown("SIGINT"); });
  process.on("SIGTERM", () => { gracefulShutdown("SIGTERM"); });
  process.on("SIGHUP", () => { gracefulShutdown("SIGHUP"); });
  rl.on("close", () => { gracefulShutdown("stdin closed"); });

  const tmux = orch.isTmuxMode;

  console.error("\x1b[1m");
  console.error("╔═══════════════════════════════════════════════════════╗");
  console.error("║   Copilot Agent Teams — PoC                         ║");
  console.error("║   Bidirectional Multi-Agent Orchestration            ║");
  console.error("║   built on @github/copilot-sdk                      ║");
  console.error("╚═══════════════════════════════════════════════════════╝");
  console.error("\x1b[0m");
  console.error(`Lead Model    : \x1b[35m${MODEL}\x1b[0m`);
  console.error(`Default Model : \x1b[34m${DEFAULT_TEAMMATE_MODEL}\x1b[0m \x1b[90m(Lead can override per teammate)\x1b[0m`);
  console.error(`Language      : \x1b[36m${LANGUAGE === "auto" ? "auto-detect" : languageDisplayName(LANGUAGE)}\x1b[0m`);
  if (DEBUG) {
    console.error(`Debug Mode    : \x1b[33menabled\x1b[0m`);
  }
  if (tmux) {
    console.error(
      "\x1b[32m✓ tmux detected — each agent gets its own pane\x1b[0m",
    );
  } else {
    console.error(
      "\x1b[33m! tmux not detected — all output in single pane\x1b[0m",
    );
    console.error(
      "\x1b[90m  Tip: run inside tmux for per-agent output panes\x1b[0m",
    );
  }
  console.error(
    "\nType a task to submit to the agent team, or 'quit' to exit.\n",
  );
  console.error("Commands:");
  console.error("  /status   — show all agents and tasks");
  console.error("  /agents   — list active agents");
  console.error("  /tasks    — list all tasks");
  console.error("  /msg <id> <text> — send message to an agent");
  console.error("  quit      — exit\n");

  // ── Event-driven notifications in main pane (tmux mode) ─────
  if (tmux) {
    const bus = orch.getBus();
    bus.on("task:created", (task) => {
      console.error(notifyTaskCreated(task.description, task.assignee));
    });
    bus.on("task:completed", (task) => {
      console.error(notifyTaskCompleted(task.description, task.assignee));
    });
  }

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "quit" || input === "exit") {
      await gracefulShutdown("user quit");
      return;
    }

    if (input === "/status") {
      const agents = orch.getAllAgents();
      const tasks = orch.getBus().listTasks();
      console.error(renderStatus(agents, tasks));
      rl.prompt();
      return;
    }

    if (input === "/agents") {
      const agents = orch.getAllAgents();
      const { renderAgentTree } = await import("./progress-display.js");
      console.error(`\n\x1b[1mActive Agents:\x1b[0m`);
      console.error(renderAgentTree(agents));
      rl.prompt();
      return;
    }

    if (input === "/tasks") {
      const tasks = orch.getBus().listTasks();
      const { renderTaskList } = await import("./progress-display.js");
      console.error(`\n\x1b[1mShared Tasks:\x1b[0m`);
      console.error(renderTaskList(tasks));
      rl.prompt();
      return;
    }

    if (input.startsWith("/msg ")) {
      const parts = input.slice(5).split(" ");
      const targetId = parts[0];
      const text = parts.slice(1).join(" ");
      if (!targetId || !text) {
        console.error("Usage: /msg <agentId> <message>");
        rl.prompt();
        return;
      }
      const agent = orch.getAgent(targetId);
      if (!agent) {
        console.error(`Agent "${targetId}" not found.`);
        rl.prompt();
        return;
      }
      // Directly inject user message into the agent's session
      agent.session.send({ prompt: `[User message]: ${text}` }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\x1b[31mFailed to send message to ${targetId}: ${msg}\x1b[0m`);
      });
      console.error(`Message sent to ${targetId}.`);
      rl.prompt();
      return;
    }

    // Submit task to the lead
    try {
      await orch.submitTask(input);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
    }

    rl.prompt();
  });
}

// ── Single-shot mode ───────────────────────────────────────────────

async function singleShotMode(orch: Orchestrator, task: string) {
  log("info", `Submitting task: "${task}"`);
  await orch.submitTask(task);
  await orch.waitForCompletion();
  await orch.stop();
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const taskFlag = args.indexOf("--task");
  const task = taskFlag !== -1 ? args[taskFlag + 1] : undefined;

  if (DEBUG) {
    log("info", "Debug logging enabled (--debug or LOG_LEVEL=debug)");
  }

  const orch = new Orchestrator({
    model: MODEL,
    pollIntervalMs: POLL_MS,
    streaming: true,
    language: LANGUAGE,
    onLog: log,
  });

  // Enable tmux-aware log filtering
  tmuxMode = orch.isTmuxMode;

  try {
    await orch.start();
    await orch.createLead(MODEL);

    if (task) {
      await singleShotMode(orch, task);
    } else {
      await interactiveMode(orch);
    }
  } catch (err: any) {
    const message = err.message ?? String(err);
    log("error", `Fatal: ${message}`);

    // Show user-friendly auth error banner (always visible, not gated by --debug)
    if (
      message.includes("gh auth login") ||
      message.includes("authentication") ||
      message.includes("auth") ||
      message.includes("401") ||
      message.includes("timed out")
    ) {
      console.error("\n\x1b[31m╔══════════════════════════════════════════════════════════╗");
      console.error("║  GitHub CLI Authentication Error                         ║");
      console.error("╠══════════════════════════════════════════════════════════╣");
      console.error("║  The Copilot SDK could not authenticate via GitHub CLI.  ║");
      console.error("║                                                          ║");
      console.error("║  Fix:                                                    ║");
      console.error("║    1. Run: gh auth login                                 ║");
      console.error("║    2. Ensure the token has 'copilot' scope               ║");
      console.error("║    3. Verify: gh auth status                             ║");
      console.error("║    4. Restart this application                           ║");
      console.error("╚══════════════════════════════════════════════════════════╝\x1b[0m\n");
    }

    await orch.stop().catch((stopErr: unknown) => {
      const msg = stopErr instanceof Error ? stopErr.message : String(stopErr);
      log("error", `Cleanup failed during fatal shutdown: ${msg}`);
    });
    process.exit(1);
  }
}

main();