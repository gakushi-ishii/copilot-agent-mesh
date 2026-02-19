/**
 * MessageBus — unit tests (migrated from manual test to Vitest)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MessageBus } from "../message-bus.js";

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
    bus.registerAgent("lead");
    bus.registerAgent("alice");
    bus.registerAgent("bob");
  });

  // ── Agent Registration ──────────────────────────────────────

  describe("Agent Registration", () => {
    it("should register agents", () => {
      expect(bus.getRegisteredAgents()).toHaveLength(3);
      expect(bus.getRegisteredAgents()).toContain("lead");
      expect(bus.getRegisteredAgents()).toContain("alice");
    });

    it("should unregister agents", () => {
      bus.unregisterAgent("bob");
      expect(bus.getRegisteredAgents()).toHaveLength(2);
      expect(bus.getRegisteredAgents()).not.toContain("bob");
    });

    it("should not duplicate agents on re-register", () => {
      bus.registerAgent("alice");
      expect(bus.getRegisteredAgents().filter((a) => a === "alice")).toHaveLength(1);
    });
  });

  // ── Direct Messaging ────────────────────────────────────────

  describe("Direct Messaging", () => {
    it("should deliver a message to the recipient", () => {
      bus.sendMessage("lead", "alice", "Hello Alice");
      expect(bus.hasUnreadMessages("alice")).toBe(true);
      expect(bus.hasUnreadMessages("bob")).toBe(false);
    });

    it("should return correct message content", () => {
      bus.sendMessage("lead", "alice", "Hello Alice");
      const msgs = bus.readMessages("alice");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].from).toBe("lead");
      expect(msgs[0].content).toBe("Hello Alice");
    });

    it("should mark messages as read after reading", () => {
      bus.sendMessage("lead", "alice", "Hello");
      bus.readMessages("alice");
      expect(bus.hasUnreadMessages("alice")).toBe(false);
    });

    it("should not mark messages as read when markRead=false", () => {
      bus.sendMessage("lead", "alice", "Hello");
      bus.readMessages("alice", false);
      expect(bus.hasUnreadMessages("alice")).toBe(true);
    });

    it("should throw when sending to nonexistent agent", () => {
      expect(() => bus.sendMessage("lead", "nonexistent", "Hello")).toThrow(
        'Agent "nonexistent" not registered',
      );
    });
  });

  // ── Broadcast ───────────────────────────────────────────────

  describe("Broadcast", () => {
    it("should deliver broadcast to all except sender", () => {
      bus.sendMessage("lead", "*", "Team update");
      expect(bus.hasUnreadMessages("alice")).toBe(true);
      expect(bus.hasUnreadMessages("bob")).toBe(true);
      expect(bus.hasUnreadMessages("lead")).toBe(false);
    });

    it("should deliver correct broadcast content", () => {
      bus.sendMessage("lead", "*", "Team update");
      const aliceMsgs = bus.readMessages("alice");
      const bobMsgs = bus.readMessages("bob");
      expect(aliceMsgs).toHaveLength(1);
      expect(bobMsgs).toHaveLength(1);
      expect(aliceMsgs[0].content).toBe("Team update");
    });
  });

  // ── Task Management ─────────────────────────────────────────

  describe("Task Management", () => {
    it("should create tasks with correct initial state", () => {
      const task = bus.createTask("Implement auth", "lead", { assignee: "alice" });
      expect(task.status).toBe("pending");
      expect(task.assignee).toBe("alice");
      expect(task.createdBy).toBe("lead");
    });

    it("should support task dependencies", () => {
      const task1 = bus.createTask("Task A", "lead");
      const task2 = bus.createTask("Task B", "lead", { dependsOn: [task1.id] });
      expect(task2.dependsOn).toContain(task1.id);
    });

    it("should allow claiming a pending task", () => {
      const task = bus.createTask("Task A", "lead");
      const claimed = bus.claimTask(task.id, "alice");
      expect(claimed.status).toBe("in-progress");
      expect(claimed.assignee).toBe("alice");
    });

    it("should block claiming when dependency is unresolved", () => {
      const task1 = bus.createTask("Task A", "lead");
      const task2 = bus.createTask("Task B", "lead", { dependsOn: [task1.id] });
      expect(() => bus.claimTask(task2.id, "bob")).toThrow(/blocked by dependency/);
    });

    it("should allow claiming after dependency is completed", () => {
      const task1 = bus.createTask("Task A", "lead");
      const task2 = bus.createTask("Task B", "lead", { dependsOn: [task1.id] });
      bus.claimTask(task1.id, "alice");
      bus.completeTask(task1.id, "alice", "Done");
      const claimed = bus.claimTask(task2.id, "bob");
      expect(claimed.status).toBe("in-progress");
    });

    it("should prevent double-claiming a task", () => {
      const task = bus.createTask("Task A", "lead");
      bus.claimTask(task.id, "alice");
      expect(() => bus.claimTask(task.id, "bob")).toThrow(/not claimable/);
    });

    it("should complete a task with result", () => {
      const task = bus.createTask("Task A", "lead");
      bus.claimTask(task.id, "alice");
      bus.completeTask(task.id, "alice", "All done");
      expect(bus.getTask(task.id)?.status).toBe("completed");
      expect(bus.getTask(task.id)?.result).toBe("All done");
    });

    it("should fail a task with reason", () => {
      const task = bus.createTask("Task A", "lead");
      bus.claimTask(task.id, "alice");
      bus.failTask(task.id, "alice", "Something broke");
      expect(bus.getTask(task.id)?.status).toBe("failed");
      expect(bus.getTask(task.id)?.result).toBe("Something broke");
    });

    it("should prevent completing a task assigned to someone else", () => {
      const task = bus.createTask("Task A", "lead");
      bus.claimTask(task.id, "alice");
      expect(() => bus.completeTask(task.id, "bob", "Done")).toThrow(
        /not assigned to "bob"/,
      );
    });
  });

  // ── Task Filtering ──────────────────────────────────────────

  describe("Task Filtering", () => {
    it("should list all tasks", () => {
      bus.createTask("Task A", "lead");
      bus.createTask("Task B", "lead");
      expect(bus.listTasks()).toHaveLength(2);
    });

    it("should filter tasks by status", () => {
      const task = bus.createTask("Task A", "lead");
      bus.createTask("Task B", "lead");
      bus.claimTask(task.id, "alice");
      expect(bus.listTasks({ status: "in-progress" })).toHaveLength(1);
      expect(bus.listTasks({ status: "pending" })).toHaveLength(1);
    });

    it("should filter tasks by assignee", () => {
      const task = bus.createTask("Task A", "lead");
      bus.claimTask(task.id, "alice");
      expect(bus.listTasks({ assignee: "alice" })).toHaveLength(1);
      expect(bus.listTasks({ assignee: "bob" })).toHaveLength(0);
    });
  });

  // ── Events ──────────────────────────────────────────────────

  describe("Events", () => {
    it("should emit message event on sendMessage", () => {
      let emitted = false;
      bus.on("message", () => { emitted = true; });
      bus.sendMessage("lead", "alice", "Hi");
      expect(emitted).toBe(true);
    });

    it("should emit task:created event", () => {
      let emitted = false;
      bus.on("task:created", () => { emitted = true; });
      bus.createTask("Task A", "lead");
      expect(emitted).toBe(true);
    });

    it("should emit task:completed event", () => {
      let emitted = false;
      bus.on("task:completed", () => { emitted = true; });
      const task = bus.createTask("Task A", "lead");
      bus.claimTask(task.id, "alice");
      bus.completeTask(task.id, "alice", "Done");
      expect(emitted).toBe(true);
    });
  });

  // ── Reset ───────────────────────────────────────────────────

  describe("Reset", () => {
    it("should clear all state on reset", () => {
      bus.sendMessage("lead", "alice", "Hi");
      bus.createTask("Task A", "lead");
      bus.reset();
      expect(bus.getRegisteredAgents()).toHaveLength(0);
      expect(bus.listTasks()).toHaveLength(0);
    });
  });
});
