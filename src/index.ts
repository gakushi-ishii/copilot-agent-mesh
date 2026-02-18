/**
 * CLI entry point — accepts a task from the user, creates the Lead,
 * submits the task, and waits for the team to finish.
 */
import { Orchestrator } from "./orchestrator.js";
import * as readline from "node:readline";

// ── Configuration ──────────────────────────────────────────────────

const MODEL = process.env.COPILOT_MODEL ?? "claude-opus-4.6";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000);
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

// ── Helpers ────────────────────────────────────────────────────────

function log(level: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const color =
    level === "error"
      ? "\x1b[31m"
      : level === "warn"
        ? "\x1b[33m"
        : level === "debug"
          ? "\x1b[90m"
          : "\x1b[36m";
  if (level === "debug" && LOG_LEVEL !== "debug") return;
  console.error(`${color}[${ts}] [${level.toUpperCase()}]\x1b[0m ${msg}`);
}

// ── Interactive REPL ───────────────────────────────────────────────

async function interactiveMode(orch: Orchestrator) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: "\n\x1b[1m🤖 Task> \x1b[0m",
  });

  console.error("\x1b[1m");
  console.error("╔═══════════════════════════════════════════════════════╗");
  console.error("║   Copilot Agent Teams — PoC                         ║");
  console.error("║   Bidirectional Multi-Agent Orchestration            ║");
  console.error("║   built on @github/copilot-sdk                      ║");
  console.error("╚═══════════════════════════════════════════════════════╝");
  console.error("\x1b[0m");
  console.error(`Lead Model : ${MODEL}`);
  console.error(`Agent Model: auto-selected per role`);
  console.error(
    "Type a task to submit to the agent team, or 'quit' to exit.\n",
  );
  console.error("Commands:");
  console.error("  /status   — show all agents and tasks");
  console.error("  /agents   — list active agents");
  console.error("  /tasks    — list all tasks");
  console.error("  /msg <id> <text> — send message to an agent");
  console.error("  quit      — exit\n");

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "quit" || input === "exit") {
      console.error("Shutting down...");
      await orch.stop();
      process.exit(0);
    }

    if (input === "/status" || input === "/agents") {
      const agents = orch.getAllAgents();
      console.error("\n\x1b[1mActive Agents:\x1b[0m");
      for (const a of agents) {
        const status = a.busy ? "\x1b[33mBUSY\x1b[0m" : "\x1b[32mIDLE\x1b[0m";
        const modelTag = a.info.model ? ` \x1b[90m[${a.info.model}]\x1b[0m` : "";
        console.error(
          `  ${a.info.id} (${a.info.role}${a.info.specialty ? `: ${a.info.specialty}` : ""}) [${status}]${modelTag}`,
        );
      }
      rl.prompt();
      return;
    }

    if (input === "/tasks") {
      const tasks = orch.getBus().listTasks();
      console.error("\n\x1b[1mShared Task List:\x1b[0m");
      if (tasks.length === 0) {
        console.error("  (empty)");
      }
      for (const t of tasks) {
        const color =
          t.status === "completed"
            ? "\x1b[32m"
            : t.status === "in-progress"
              ? "\x1b[33m"
              : t.status === "failed"
                ? "\x1b[31m"
                : "\x1b[0m";
        console.error(
          `  ${t.id} ${color}[${t.status}]\x1b[0m ${t.description} → ${t.assignee ?? "unassigned"}`,
        );
        if (t.result) {
          console.error(`    Result: ${t.result.slice(0, 120)}...`);
        }
      }
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
      agent.session.send({ prompt: `[User message]: ${text}` }).catch(() => {});
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

  const orch = new Orchestrator({
    model: MODEL,
    pollIntervalMs: POLL_MS,
    streaming: true,
    onLog: log,
  });

  try {
    await orch.start();
    await orch.createLead(MODEL);

    if (task) {
      await singleShotMode(orch, task);
    } else {
      await interactiveMode(orch);
    }
  } catch (err: any) {
    log("error", `Fatal: ${err.message}`);
    await orch.stop().catch(() => {});
    process.exit(1);
  }
}

main();
