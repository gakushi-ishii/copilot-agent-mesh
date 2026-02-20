# Copilot Agent Mesh

Copilot Agent Mesh is a proof-of-concept multi-agent orchestration system that coordinates multiple GitHub Copilot sessions so they can exchange messages bidirectionally and complete tasks as a team. Unlike unidirectional sub-agent patterns, teammates communicate directly through shared mailboxes, enabling true collaboration.

Built on [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk), the system uses an in-memory message bus and custom tool injection to implement a **Lead + Teammates** pattern. The Lead agent dynamically spawns specialist teammates, delegates work, and synthesizes results — while teammates coordinate among themselves using shared mailboxes and a task list.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Get Started](#get-started)
  - [Interactive Mode](#interactive-mode)
  - [Single-Shot Mode](#single-shot-mode)
  - [Session Commands](#session-commands)
- [Features](#features)
  - [Bidirectional Agent Communication](#bidirectional-agent-communication)
  - [Multi-Model Support](#multi-model-support)
  - [tmux Multi-Pane Mode](#tmux-multi-pane-mode)
  - [Shared Task List](#shared-task-list)
  - [Progress Display](#progress-display)
- [Architecture](#architecture)
  - [Tech Stack](#tech-stack)
  - [Source Files](#source-files)
  - [Communication Flow](#communication-flow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [License](#license)

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18 or later |
| GitHub Copilot CLI | Latest |
| GitHub Copilot License | Active subscription |
| tmux (optional) | Any recent version |

> [!NOTE]
> `@github/copilot-sdk` is in technical preview (v0.1.x). Expect breaking changes between releases.

> [!NOTE]
> tmux is optional but strongly recommended. When running inside tmux, each agent gets its own pane with a persistent border title showing the agent name, role, and model.

## Installation

### Option A: DevContainer (Recommended)

The easiest way to get started, especially on Windows. The DevContainer includes Node.js, tmux, and GitHub CLI pre-configured.

**From VSCode:**

1. Install the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.
2. Open the repository folder in VSCode.
3. Press `F1` → **Dev Containers: Reopen in Container**.
4. The container builds automatically with all dependencies.

**From an external terminal (full tmux experience):**

After the DevContainer is running, connect from any terminal emulator:

```bash
# Find the running container
docker ps --filter "label=devcontainer.local_folder" --format "table {{.Names}}\t{{.ID}}"

# Attach with an interactive shell, then start tmux
docker exec -it <container-name> bash -c "cd /workspaces/copilot-agent-mesh && exec bash"
tmux new-session -s mesh
npm start
```

> [!TIP]
> If you prefer the full tmux experience with a dedicated terminal (e.g., Windows Terminal, iTerm2), use `docker exec` to connect to the DevContainer. The VSCode integrated terminal also supports tmux, but an external terminal may feel more natural for heavy tmux usage.

**Without VSCode (using `devcontainer` CLI):**

```bash
npm install -g @devcontainers/cli
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . bash
```

### Option B: Local Setup

1. Clone the repository.

   ```bash
   git clone https://github.com/gakushi-ishii/copilot-agent-mesh.git
   cd copilot-agent-mesh
   ```

2. Install dependencies.

   ```bash
   npm install
   ```

3. Verify that the GitHub Copilot CLI is available on your PATH.

   ```bash
   copilot --version
   ```

4. Build TypeScript (optional — you can run directly with `tsx`).

   ```bash
   npm run build
   ```

> [!NOTE]
> On Windows, tmux requires WSL. Install WSL 2 and run the application inside your WSL distribution.

## Get Started

### Interactive Mode

Launch the interactive REPL to submit tasks and monitor the team in real time.

```bash
npm start
```

After startup, type a task at the prompt. The Lead agent assembles a team and begins work.

```text
🤖 Task> Review this PR from three angles: security, performance, and test coverage
```

The system displays a startup banner with the current model configuration:

```text
╔═══════════════════════════════════════════════════════╗
║   Copilot Agent Teams — PoC                         ║
║   Bidirectional Multi-Agent Orchestration            ║
║   built on @github/copilot-sdk                      ║
╚═══════════════════════════════════════════════════════╝
Lead Model    : claude-opus-4.6
Default Model : claude-sonnet-4.6 (Lead can override per teammate)
```

### Single-Shot Mode

Pass a task as an argument. The system runs to completion and exits automatically.

```bash
npm start -- --task "Run a security review of the authentication module"
```

### Session Commands

Use these commands during an interactive session:

| Command | Description |
|---------|-------------|
| `/status` | Show all agents and tasks with a summary |
| `/agents` | Display a tree view of active agents with model and status |
| `/tasks` | Display the shared task checklist |
| `/msg <id> <text>` | Send a message directly to a specific agent |
| `quit` | Gracefully shut down all agents and exit |

## Features

### Bidirectional Agent Communication

Agents exchange messages through a mailbox system on the in-memory message bus. Each agent has a dedicated mailbox. Messages are delivered by a polling loop that injects unread messages as prompts into the recipient's Copilot session.

Available communication tools for every agent:

| Tool | Description |
|------|-------------|
| `send_message` | Send a direct message to a specific teammate |
| `broadcast` | Send a message to all teammates at once |
| `read_messages` | Check the mailbox for unread messages |
| `list_teammates` | List all currently registered teammates |

### Multi-Model Support

The Lead agent selects the best model for each teammate at spawn time. This enables cost-effective allocation: fast, lightweight models for simple tasks and powerful models for complex reasoning.

| Model | Best For |
|-------|----------|
| `claude-opus-4.6` | Complex multi-step reasoning, architecture, security |
| `claude-sonnet-4.6` | Code generation, review, testing, analysis (default for teammates) |
| `gpt-5.3-codex` | Large-scale code generation, multi-file refactoring |
| `claude-haiku-3.5` | Documentation, formatting, translation, simple tasks |

The Lead runs on `claude-opus-4.6` by default. Teammates default to `claude-sonnet-4.6` unless the Lead specifies otherwise.

### tmux Multi-Pane Mode

When running inside tmux, each agent gets its own pane with:

- **Persistent border titles** showing agent name, role, and model (e.g., `@security-reviewer (security) [sonnet-4.6]`)
- **Real-time streaming output** routed to the dedicated pane
- **Status indicators** (`⏳ Thinking`, `▶ Working`, `● Idle`, `✓ Done`)
- **Tiled layout** automatically rearranged as teammates are spawned or shut down

The main pane stays clean and interactive — only structured notifications (new tasks, completed tasks) appear there.

Without tmux, all agent output is interleaved in a single terminal with `[AgentName]` prefixes.

### Shared Task List

All agents share a task list with dependency tracking. The Lead creates tasks and assigns them; teammates claim and complete tasks.

| Tool | Description |
|------|-------------|
| `create_task` | Create a task with optional assignee and dependencies |
| `claim_task` | Claim an unassigned pending task |
| `complete_task` | Mark a task as completed with a result summary |
| `list_tasks` | View the task list filtered by status |

Tasks support four states: `pending`, `in-progress`, `completed`, and `failed`. A task blocked by unresolved dependencies cannot be claimed.

### Progress Display

The `/status` command renders a structured overview:

- **Agent tree** — shows all agents with role, model, and busy/idle state
- **Task checklist** — shows all tasks with status icons (`□` pending, `■` in-progress, `✓` completed, `✗` failed)
- **Summary line** — busy count, task completion ratio, and model breakdown

### Lead-Only Tools

The Lead agent has exclusive access to team management tools:

| Tool | Description |
|------|-------------|
| `spawn_teammate` | Create a new teammate with a name, role, initial prompt, and model |
| `shutdown_teammate` | Gracefully shut down a teammate and clean up resources |

## Architecture

```text
┌──────────────────────────────────────────────────────┐
│               Orchestrator (Node.js)                 │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Lead    │  │Teammate A│  │Teammate B│  ...      │
│  │ Session  │  │ Session  │  │ Session  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                 │
│  ┌────┴──────────────┴──────────────┴────┐           │
│  │        Message Bus (in-memory)        │           │
│  │   Mailbox + Task List + EventEmitter  │           │
│  └───────────────────────────────────────┘           │
│                                                      │
│  ┌───────────────────────────────────────┐           │
│  │        TmuxManager (optional)         │           │
│  │   Per-agent panes + streaming output  │           │
│  └───────────────────────────────────────┘           │
│                                                      │
│  ┌───────────────────────────────────────┐           │
│  │     CopilotClient (1 instance)        │           │
│  │    ← JSON-RPC → Copilot CLI           │           │
│  └───────────────────────────────────────┘           │
└──────────────────────────────────────────────────────┘
```

### Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript (ES2022) | Implementation language |
| `@github/copilot-sdk` | Programmatic control of the Copilot CLI |
| `zod` | Schema definitions for custom agent tools |
| `tsx` | Direct TypeScript execution without a build step |
| Node.js EventEmitter | Event-driven notifications on the message bus |
| tmux | Optional per-agent output pane isolation |

### Source Files

| File | Responsibility |
|------|---------------|
| `src/index.ts` | CLI entry point — interactive REPL and single-shot mode |
| `src/orchestrator.ts` | Core engine — agent lifecycle, message delivery loop, team coordination |
| `src/message-bus.ts` | In-memory mailboxes and shared task list with dependency tracking |
| `src/agent-tools.ts` | Custom tool definitions via `defineTool()` + Zod schemas |
| `src/agent-session.ts` | Agent type definitions and system message generation |
| `src/progress-display.ts` | Structured rendering — agent tree, task checklist, event notifications |
| `src/tmux-pane.ts` | tmux pane management — create, write, close, border titles |
| `src/__tests__/message-bus.test.ts` | Unit tests for the MessageBus |

### Communication Flow

1. An agent calls the `send_message` tool
2. The tool handler writes the message to the recipient's mailbox on the Message Bus
3. A polling loop detects unread messages in the recipient's mailbox
4. Unread messages are injected as a prompt into the recipient's Copilot session
5. The recipient agent reads the messages and responds or takes action

Each agent has a configurable maximum turn limit (`maxTurnsPerAgent`, default 20) to prevent infinite loops. When an agent is busy, incoming messages are enqueued via the SDK's enqueue mode and processed when the agent becomes idle.

## Command Reference

| Command | Description |
|---------|-------------|
| `npm start` | Start in interactive mode |
| `npm start -- --task "..."` | Start in single-shot mode |
| `npm start -- --debug` | Start with debug logging enabled |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Start in watch mode (auto-restart on changes) |
| `npm test` | Run MessageBus unit tests |

## Configuration

Configure behavior through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_MODEL` | `claude-opus-4.6` | Model for the Lead agent |
| `POLL_INTERVAL_MS` | `2000` | Message polling interval in milliseconds |
| `LOG_LEVEL` | `info` | Log verbosity (`info` or `debug`) |

Example:

```bash
COPILOT_MODEL=claude-sonnet-4.6 LOG_LEVEL=debug npm start
```

> [!NOTE]
> The `--debug` CLI flag is equivalent to setting `LOG_LEVEL=debug`.

## License

ISC
