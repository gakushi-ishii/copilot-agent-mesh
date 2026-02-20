/**
 * Tests for GitHub CLI authentication pre-flight check
 * and the withTimeout helper exported from orchestrator.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";

// We test the exported checkGitHubCliAuth function
import { checkGitHubCliAuth } from "../orchestrator.js";

// Stub execFile so we never call the real `gh` CLI
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof childProcess>();
  return {
    ...original,
    execFile: vi.fn(),
  };
});

function mockExecFile(
  opts: { stdout?: string; stderr?: string; error?: Error | null },
) {
  const mock = vi.mocked(childProcess.execFile);
  mock.mockImplementation(
    ((_cmd: unknown, _args: unknown, _options: unknown, callback?: Function) => {
      if (callback) {
        if (opts.error) {
          const err = opts.error as Error & { stderr?: string };
          err.stderr = opts.stderr ?? "";
          callback(err, opts.stdout ?? "", opts.stderr ?? "");
        } else {
          callback(null, opts.stdout ?? "", opts.stderr ?? "");
        }
      }
    }) as typeof childProcess.execFile,
  );
}

describe("checkGitHubCliAuth", () => {
  const logMessages: Array<{ level: string; msg: string }> = [];
  const log = (level: "info" | "debug" | "warn" | "error", msg: string) => {
    logMessages.push({ level, msg });
  };

  beforeEach(() => {
    logMessages.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves when gh auth status succeeds", async () => {
    mockExecFile({
      stdout: "",
      stderr: "Logged in to github.com account user (token)",
    });
    await expect(checkGitHubCliAuth(log)).resolves.toBeUndefined();
    expect(logMessages.some((m) => m.msg.includes("verified"))).toBe(true);
  });

  it("throws when gh auth status fails (not logged in)", async () => {
    mockExecFile({
      error: new Error("exit code 1"),
      stderr: "You are not logged into any GitHub hosts. Run gh auth login to authenticate.",
    });
    await expect(checkGitHubCliAuth(log)).rejects.toThrow("gh auth login");
    expect(logMessages.some((m) => m.level === "error")).toBe(true);
  });

  it("throws when gh is not installed", async () => {
    mockExecFile({
      error: new Error("spawn gh ENOENT"),
      stderr: "",
    });
    await expect(checkGitHubCliAuth(log)).rejects.toThrow("gh auth login");
    expect(logMessages.some((m) => m.level === "error" && m.msg.includes("failed"))).toBe(true);
  });

  it("includes stderr detail in the thrown error", async () => {
    const detail = "The token in /home/user/.config/gh/hosts.yml is invalid";
    mockExecFile({
      error: new Error("exit code 1"),
      stderr: detail,
    });
    await expect(checkGitHubCliAuth(log)).rejects.toThrow(detail);
  });
});
