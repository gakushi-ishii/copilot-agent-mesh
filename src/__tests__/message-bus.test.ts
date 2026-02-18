/**
 * Lightweight test for MessageBus — no test framework needed.
 */
import { MessageBus } from "../message-bus.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// ─── Tests ────────────────────────────────────────────────────────

const bus = new MessageBus();

section("Agent Registration");
bus.registerAgent("lead");
bus.registerAgent("alice");
bus.registerAgent("bob");
assert(bus.getRegisteredAgents().length === 3, "3 agents registered");

section("Direct Messaging");
bus.sendMessage("lead", "alice", "Hello Alice");
assert(bus.hasUnreadMessages("alice"), "Alice has unread messages");
assert(!bus.hasUnreadMessages("bob"), "Bob has no unread messages");

const msgs = bus.readMessages("alice");
assert(msgs.length === 1, "Alice received 1 message");
assert(msgs[0].from === "lead", "Message is from lead");
assert(msgs[0].content === "Hello Alice", "Message content matches");
assert(!bus.hasUnreadMessages("alice"), "Alice messages marked as read");

section("Broadcast");
bus.sendMessage("lead", "*", "Team update");
assert(bus.hasUnreadMessages("alice"), "Alice got broadcast");
assert(bus.hasUnreadMessages("bob"), "Bob got broadcast");
assert(!bus.hasUnreadMessages("lead"), "Lead did not get own broadcast");

const aliceBroadcast = bus.readMessages("alice");
const bobBroadcast = bus.readMessages("bob");
assert(aliceBroadcast.length === 1, "Alice got 1 broadcast");
assert(bobBroadcast.length === 1, "Bob got 1 broadcast");

section("Task Management");
const task1 = bus.createTask("Implement auth module", "lead", { assignee: "alice" });
const task2 = bus.createTask("Write tests", "lead", { dependsOn: [task1.id] });

assert(task1.status === "pending", "Task 1 is pending");
assert(task2.dependsOn.includes(task1.id), "Task 2 depends on Task 1");

// Claim task 1
const claimed = bus.claimTask(task1.id, "alice");
assert(claimed.status === "in-progress", "Task 1 claimed by Alice");

// Task 2 should be blocked
let blocked = false;
try {
  bus.claimTask(task2.id, "bob");
} catch {
  blocked = true;
}
assert(blocked, "Task 2 blocked by dependency");

// Complete task 1
bus.completeTask(task1.id, "alice", "Auth module implemented with JWT");
assert(bus.getTask(task1.id)?.status === "completed", "Task 1 completed");

// Now task 2 should be claimable
const claimed2 = bus.claimTask(task2.id, "bob");
assert(claimed2.status === "in-progress", "Task 2 now claimable after dep resolved");

section("Task Listing & Filtering");
const allTasks = bus.listTasks();
assert(allTasks.length === 2, "2 total tasks");
const inProgress = bus.listTasks({ status: "in-progress" });
assert(inProgress.length === 1, "1 in-progress task");
assert(inProgress[0].assignee === "bob", "In-progress task assigned to Bob");

section("Error Handling");
let errorThrown = false;
try {
  bus.sendMessage("lead", "nonexistent", "Hello");
} catch {
  errorThrown = true;
}
assert(errorThrown, "Error thrown for nonexistent agent");

let doubleClaimError = false;
try {
  bus.claimTask(task2.id, "alice"); // already claimed by bob
} catch {
  doubleClaimError = true;
}
assert(doubleClaimError, "Cannot double-claim a task");

// ─── Summary ──────────────────────────────────────────────────────

console.log(`\n${"═".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
