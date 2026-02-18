/**
 * progress-display.ts — Renders structured progress output
 * for the main terminal pane, inspired by Claude Code Agent Teams.
 *
 * Provides tree-view of agents and checklist-view of tasks
 * instead of raw log output.
 */
import type { ManagedAgent } from "./agent-session.js";
import type { Task } from "./message-bus.js";

// ── ANSI helpers ───────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// ── Agent Tree ─────────────────────────────────────────────────────

/**
 * Render a tree view of active agents, similar to:
 *
 *   ● 2 agents launched
 *     ├ @performance-reviewer (Explore) [BUSY] [claude-sonnet-4.6]
 *     └ @ux-reviewer (Explore) [IDLE] [claude-sonnet-4.6]
 */
export function renderAgentTree(agents: ManagedAgent[]): string {
  const teammates = agents.filter((a) => a.info.role !== "lead");
  const lead = agents.find((a) => a.info.role === "lead");

  const lines: string[] = [];

  if (lead) {
    const status = lead.busy
      ? `${YELLOW}BUSY${RESET}`
      : `${GREEN}IDLE${RESET}`;
    const model = lead.info.model ? ` ${DIM}[${lead.info.model}]${RESET}` : "";
    lines.push(
      `${BOLD}${GREEN}●${RESET} ${BOLD}@${lead.info.name}${RESET} (lead) [${status}]${model}`,
    );
  }

  if (teammates.length === 0) {
    lines.push(`  ${DIM}(no teammates spawned)${RESET}`);
  } else {
    lines.push(
      `${BOLD}● ${teammates.length} teammate(s) active${RESET}`,
    );
    teammates.forEach((tm, i) => {
      const isLast = i === teammates.length - 1;
      const branch = isLast ? "└" : "├";
      const status = tm.busy
        ? `${YELLOW}BUSY${RESET}`
        : `${GREEN}IDLE${RESET}`;
      const specialty = tm.info.specialty
        ? ` ${DIM}(${tm.info.specialty})${RESET}`
        : "";
      const model = tm.info.model ? ` ${DIM}[${tm.info.model}]${RESET}` : "";
      lines.push(
        `  ${branch} ${CYAN}@${tm.info.name}${RESET}${specialty} [${status}]${model}`,
      );
    });
  }

  return lines.join("\n");
}

// ── Task Checklist ─────────────────────────────────────────────────

/**
 * Render a checklist view of tasks, similar to:
 *
 *   ■ Review API endpoints     → @reviewer [in-progress]
 *   ✓ Fix login bug            → @coder [completed]
 *   □ Write tests              → unassigned [pending]
 *   ✗ Deploy staging           → @devops [failed]
 */
export function renderTaskList(tasks: Task[]): string {
  if (tasks.length === 0) {
    return `  ${DIM}(no tasks)${RESET}`;
  }

  const lines: string[] = [];
  for (const t of tasks) {
    const icon = taskIcon(t.status);
    const color = taskColor(t.status);
    const assignee = t.assignee ?? "unassigned";
    const desc =
      t.description.length > 50
        ? t.description.slice(0, 47) + "..."
        : t.description;
    const result =
      t.status === "completed" && t.result
        ? `\n      ${DIM}→ ${t.result.slice(0, 100)}${RESET}`
        : "";
    lines.push(
      `  ${icon} ${color}${desc}${RESET} → ${CYAN}${assignee}${RESET} ${DIM}[${t.status}]${RESET}${result}`,
    );
  }

  return lines.join("\n");
}

// ── Full Status View ───────────────────────────────────────────────

/**
 * Render a complete status view combining agents and tasks.
 */
export function renderStatus(
  agents: ManagedAgent[],
  tasks: Task[],
): string {
  const sections: string[] = [];

  sections.push(`\n${BOLD}Active Agents:${RESET}`);
  sections.push(renderAgentTree(agents));

  sections.push(`\n${BOLD}Shared Tasks:${RESET}`);
  sections.push(renderTaskList(tasks));

  // Summary line
  const busyCount = agents.filter((a) => a.busy).length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const totalTasks = tasks.length;
  sections.push(
    `\n${DIM}${busyCount} busy │ ${completedTasks}/${totalTasks} tasks done${RESET}`,
  );

  return sections.join("\n");
}

// ── Event notifications for main pane ──────────────────────────────

export function notifyAgentSpawned(name: string, role: string, model?: string): string {
  const modelTag = model ? ` ${DIM}[${model}]${RESET}` : "";
  return `${GREEN}+${RESET} ${BOLD}@${name}${RESET} spawned ${DIM}(${role})${RESET}${modelTag}`;
}

export function notifyAgentShutdown(name: string): string {
  return `${RED}-${RESET} ${BOLD}@${name}${RESET} shut down`;
}

export function notifyTaskCreated(desc: string, assignee?: string): string {
  const target = assignee ? ` → ${CYAN}${assignee}${RESET}` : "";
  return `${YELLOW}◆${RESET} New task: ${desc.slice(0, 60)}${target}`;
}

export function notifyTaskCompleted(desc: string, assignee?: string): string {
  const by = assignee ? ` by ${CYAN}${assignee}${RESET}` : "";
  return `${GREEN}✓${RESET} Task done: ${desc.slice(0, 60)}${by}`;
}

// ── Helpers ────────────────────────────────────────────────────────

function taskIcon(status: string): string {
  switch (status) {
    case "completed":
      return `${GREEN}✓${RESET}`;
    case "in-progress":
      return `${YELLOW}■${RESET}`;
    case "failed":
      return `${RED}✗${RESET}`;
    default:
      return `${DIM}□${RESET}`;
  }
}

function taskColor(status: string): string {
  switch (status) {
    case "completed":
      return GREEN;
    case "in-progress":
      return YELLOW;
    case "failed":
      return RED;
    default:
      return "";
  }
}
