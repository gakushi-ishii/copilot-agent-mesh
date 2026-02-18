/**
 * Message Bus — in-memory inter-agent messaging and shared task list.
 *
 * Inspired by Claude Code Agent Teams' mailbox + task list architecture,
 * but kept entirely in-memory for the PoC phase.
 */
import { EventEmitter } from "node:events";

// ─── Types ───────────────────────────────────────────────────────────

export interface AgentMessage {
  id: string;
  from: string;
  to: string; // "*" = broadcast
  content: string;
  timestamp: number;
  read: boolean;
}

export type TaskStatus = "pending" | "in-progress" | "completed" | "failed";

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  assignee?: string;
  createdBy: string;
  dependsOn: string[];
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageBusEvents {
  message: [msg: AgentMessage];
  "task:created": [task: Task];
  "task:updated": [task: Task];
  "task:completed": [task: Task];
}

// ─── Message Bus ─────────────────────────────────────────────────────

export class MessageBus extends EventEmitter {
  private mailboxes = new Map<string, AgentMessage[]>();
  private tasks = new Map<string, Task>();
  private msgCounter = 0;
  private taskCounter = 0;

  // ── Agent registration ────────────────────────────────────────────

  registerAgent(agentId: string): void {
    if (!this.mailboxes.has(agentId)) {
      this.mailboxes.set(agentId, []);
    }
  }

  unregisterAgent(agentId: string): void {
    this.mailboxes.delete(agentId);
  }

  getRegisteredAgents(): string[] {
    return [...this.mailboxes.keys()];
  }

  // ── Messaging ─────────────────────────────────────────────────────

  sendMessage(from: string, to: string, content: string): AgentMessage {
    const msg: AgentMessage = {
      id: `msg-${++this.msgCounter}`,
      from,
      to,
      content,
      timestamp: Date.now(),
      read: false,
    };

    if (to === "*") {
      // Broadcast to all except sender
      for (const [agentId, box] of this.mailboxes) {
        if (agentId !== from) {
          box.push({ ...msg, to: agentId });
        }
      }
    } else {
      const box = this.mailboxes.get(to);
      if (!box) {
        throw new Error(`Agent "${to}" not registered`);
      }
      box.push(msg);
    }

    this.emit("message", msg);
    return msg;
  }

  readMessages(agentId: string, markRead = true): AgentMessage[] {
    const box = this.mailboxes.get(agentId);
    if (!box) return [];

    const unread = box.filter((m) => !m.read);
    if (markRead) {
      unread.forEach((m) => (m.read = true));
    }
    return unread;
  }

  hasUnreadMessages(agentId: string): boolean {
    const box = this.mailboxes.get(agentId);
    if (!box) return false;
    return box.some((m) => !m.read);
  }

  // ── Task List ─────────────────────────────────────────────────────

  createTask(
    description: string,
    createdBy: string,
    opts?: { assignee?: string; dependsOn?: string[] },
  ): Task {
    const task: Task = {
      id: `task-${++this.taskCounter}`,
      description,
      status: "pending",
      createdBy,
      assignee: opts?.assignee,
      dependsOn: opts?.dependsOn ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    this.emit("task:created", task);
    return task;
  }

  claimTask(taskId: string, agentId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== "pending")
      throw new Error(`Task "${taskId}" is not claimable (status: ${task.status})`);

    // Check unresolved dependencies
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (dep && dep.status !== "completed") {
        throw new Error(
          `Task "${taskId}" blocked by dependency "${depId}" (status: ${dep.status})`,
        );
      }
    }

    task.assignee = agentId;
    task.status = "in-progress";
    task.updatedAt = Date.now();
    this.emit("task:updated", task);
    return task;
  }

  completeTask(taskId: string, agentId: string, result: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.assignee !== agentId)
      throw new Error(`Task "${taskId}" is not assigned to "${agentId}"`);

    task.status = "completed";
    task.result = result;
    task.updatedAt = Date.now();
    this.emit("task:completed", task);
    return task;
  }

  failTask(taskId: string, agentId: string, reason: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);

    task.status = "failed";
    task.result = reason;
    task.updatedAt = Date.now();
    this.emit("task:updated", task);
    return task;
  }

  listTasks(filter?: { status?: TaskStatus; assignee?: string }): Task[] {
    let list = [...this.tasks.values()];
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.assignee) list = list.filter((t) => t.assignee === filter.assignee);
    return list;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  // ── Utilities ─────────────────────────────────────────────────────

  reset(): void {
    this.mailboxes.clear();
    this.tasks.clear();
    this.msgCounter = 0;
    this.taskCounter = 0;
    this.removeAllListeners();
  }
}
