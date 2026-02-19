/**
 * MessagePoller — unit tests for polling & message delivery robustness.
 *
 * The poller's sole responsibility is detecting unread messages and
 * forwarding them to the sendToAgent callback.  It does NOT check
 * agent.busy or turn limits — those are enforced by sendToAgent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MessageBus } from "../message-bus.js";
import { MessagePoller, type SendToAgentFn } from "../message-poller.js";
import type { ManagedAgent, AgentInfo } from "../agent-session.js";

/** Create a minimal ManagedAgent stub. */
function stubAgent(id: string, name: string): ManagedAgent {
  return {
    info: { id, name, role: "teammate" } as AgentInfo,
    session: {} as any,
    busy: false,
  };
}

describe("MessagePoller", () => {
  let bus: MessageBus;
  const noop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MessageBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should deliver unread messages via sendToAgent callback", async () => {
    bus.registerAgent("alice");
    bus.registerAgent("bob");

    const delivered: string[] = [];
    const sendFn: SendToAgentFn = async (_agent, prompt) => {
      delivered.push(prompt);
    };

    const poller = new MessagePoller(
      bus,
      { pollIntervalMs: 100, log: noop },
      sendFn,
    );

    const bob = stubAgent("bob", "Bob");
    poller.startPolling(bob);

    bus.sendMessage("alice", "bob", "Hello Bob");

    // Advance timer to trigger the poll
    await vi.advanceTimersByTimeAsync(150);

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("Hello Bob");
    expect(bus.hasUnreadMessages("bob")).toBe(false);

    poller.stopAll();
  });

  it("should still forward messages when agent is busy (sendToAgent decides enqueue)", async () => {
    bus.registerAgent("alice");
    bus.registerAgent("bob");

    const delivered: string[] = [];
    const sendFn: SendToAgentFn = async (_agent, prompt) => {
      delivered.push(prompt);
    };

    const poller = new MessagePoller(
      bus,
      { pollIntervalMs: 100, log: noop },
      sendFn,
    );

    const bob = stubAgent("bob", "Bob");
    bob.busy = true;
    poller.startPolling(bob);

    bus.sendMessage("alice", "bob", "Hello Bob");

    await vi.advanceTimersByTimeAsync(150);

    // Message IS forwarded to sendToAgent — it's sendToAgent's job to enqueue
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("Hello Bob");
    expect(bus.hasUnreadMessages("bob")).toBe(false);

    poller.stopAll();
  });

  it("should log error when sendToAgent fails (no re-queue)", async () => {
    bus.registerAgent("alice");
    bus.registerAgent("bob");

    const sendFn: SendToAgentFn = async () => {
      throw new Error("delivery failed");
    };

    const errors: string[] = [];
    const logFn = (level: string, msg: string) => {
      if (level === "error") errors.push(msg);
    };

    const poller = new MessagePoller(
      bus,
      { pollIntervalMs: 100, log: logFn },
      sendFn,
    );

    const bob = stubAgent("bob", "Bob");
    poller.startPolling(bob);

    bus.sendMessage("alice", "bob", "Important message");

    await vi.advanceTimersByTimeAsync(150);

    // Error is logged but messages are NOT re-queued (they were already read)
    expect(errors.some((e) => e.includes("delivery failed"))).toBe(true);
    expect(bus.hasUnreadMessages("bob")).toBe(false);

    poller.stopAll();
  });

  it("should stop polling when stopPolling is called", async () => {
    bus.registerAgent("alice");
    bus.registerAgent("bob");

    const delivered: string[] = [];
    const sendFn: SendToAgentFn = async (_agent, prompt) => {
      delivered.push(prompt);
    };

    const poller = new MessagePoller(
      bus,
      { pollIntervalMs: 100, log: noop },
      sendFn,
    );

    const bob = stubAgent("bob", "Bob");
    poller.startPolling(bob);
    poller.stopPolling("bob");

    bus.sendMessage("alice", "bob", "Hello Bob");

    await vi.advanceTimersByTimeAsync(300);

    // Polling was stopped — no delivery
    expect(delivered).toHaveLength(0);
  });

  it("should stop all polling when stopAll is called", async () => {
    bus.registerAgent("alice");
    bus.registerAgent("bob");

    const delivered: string[] = [];
    const sendFn: SendToAgentFn = async (_agent, prompt) => {
      delivered.push(prompt);
    };

    const poller = new MessagePoller(
      bus,
      { pollIntervalMs: 100, log: noop },
      sendFn,
    );

    const bob = stubAgent("bob", "Bob");
    poller.startPolling(bob);
    poller.stopAll();

    bus.sendMessage("alice", "bob", "Hello Bob");

    await vi.advanceTimersByTimeAsync(300);

    expect(delivered).toHaveLength(0);
  });
});
