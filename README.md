# Homu Code

Homu Code is a fork of [T3 Code](https://github.com/pingdotgg/t3code), changed for running many coding agents at once. It starts from upstream commit `637507056c` (2026-11-08) and has no releases or installers of its own: build it from source. Inside the app and the `t3` command it is still called T3 Code.

## Changes compared to T3 Code

- **Server speed.**
  - **Migration checks without a write lock.** In upstream T3 Code, every `t3` CLI command ran the database migration step inside a write-locked transaction on the live database, even when there was nothing to migrate. Each CLI call competed with the server's own writes and could wait up to SQLite's 5-second busy timeout. Homu Code first checks the recorded migration history with a plain read and skips the locked step when the schema is already current, so CLI calls no longer hold up, or wait on, the server.
  - **Cheaper work-assistance activity reads.** Work assistance (a Homu Code feature, see Known limits) re-reads thread activity as thread events arrive, for every thread it covers on each provider-session event. That query re-parsed every provider thread's stored JSON for each attached row; with one shared Codex session holding about 400 threads, a read took about 400 ms and kept the server's event loop near 94% busy. It now extracts each fork parent once (about 34 ms per read on the same data), and reads activity once per batch of events instead of once per event. In streaming bursts the per-event reads had used about 39% of the event loop.
  - **Background Git can be switched off.** Start the server with the environment variable `T3CODE_BACKGROUND_GIT=0` to stop the Git work it does on its own: automatic Git status and branch subscriptions, fetch and auto-pull, pull-request discovery, sync, watches and auto-settlement, new turn checkpoints, and automatic worktree cleanup. Restart to apply or remove it; unset keeps upstream's behavior. While it is off, new turns have no checkpoint diff or undo and the branch and Changes displays don't update by themselves, but explicit Git actions, status refresh from the Git action menu, PR linking, manual cleanup and worktree creation still work. See [Disable background Git](./docs/user/source-control.md#disable-background-git).
  - **Git config cache.** `git config` reads are cached for one second, and identical reads in flight are shared, which cuts repeated Git calls from status and pull-request lookups. Callers that need a fresh value skip the cache, a fresh read drops the whole cache, and background and foreground reads are cached separately.
- **Subagents and moves.** Pinned subagents get their own row in the sidebar's pinned group, naming their parent. Threads can be moved under another thread or to the root (`thread.move`, the `t3_thread_organize` tool, and the thread menus), with guards so no pending result or wait is lost.
- **Stop.** Stop stops only the current thread. Shift-click, the background-work Stop or `/stopall` also stops its subagents.
- **Message context.** Each user message records which device it came from, and the agent sees a `[T3] Sent from: ...` line. Optional names come from `device-names.json` in the state folder.
- **`/q`.** Asks one question in the same thread on a "Quick model" (a new setting): the thread switches to the quick model for that one answer, then switches back to its own model. Context and prompt cache are kept: on the same provider the answer runs in the thread's own provider conversation, so nothing is handed off. On another provider the quick model gets a summary of the thread, and the switch back resumes the thread's original provider conversation with only the missed turn added.
- **`/cd`.** `/cd <folder>` moves the thread to that folder's project and adds the project if there isn't one yet. A relative folder starts from the thread's current one, and `~` works. A started thread keeps its conversation and runs in the new folder from its next turn; it has to be idle first. In a new thread that hasn't started, `/cd` opens a new thread in that project instead. Web and desktop only.
- **Autoreviewers.** An `autoreview` tool attaches reviewer subagents to a thread. They read its activity in batches and send back findings, which steer into the running turn or wait in one queued message. Options cover batch size, pacing, waking on each tool call or each user message, and a custom preamble. Findings that arrive after a Stop wait for the user's next turn. They are off by default: turn on Settings → Threads → Autoreviewers (`autoreviewEnabled`). While it is off the tool refuses to add reviewers, and reviewers already attached pause until it is back on. Using them isn't recommended. They often get in the way of other threads because they lag behind: if the main thread keeps working, the reviewer gets no new context until it replies, and that reply is based only on old context. Other times a reviewer gets stuck replying LGTM over and over.
- **Queue and steering.** Messages sent with delivery mode auto or steer are steered in as soon as the turn can take them. `t3 thread send` takes `--mode queue|auto|steer|restart`, and `t3 thread configure` sets permission and interaction modes.
- **Completions and CLI.** A durable local completion sink and native CLI task controls. Launch receipts and the AppImage runtime are reused across CLI calls.
- **Desktop on Linux.** Thread links reuse the pinned AppImage cache, and URL launches request Wayland activation.
- **Sidebar folders.** Thread folders in the sidebar, ported from upstream PR #26714 without its mobile part.
- **Smaller items.** Schedule and usage-stop fixes, settle timestamps and agent message timestamps, a human-message timestamp in activity, thread title instructions that override the default length limits, project router creation notices (off by default; see [docs/project-router-notices.md](./docs/project-router-notices.md)), and thread and project pins kept per device.

Known limits:

- Work assistance (`apps/server/src/orchestration-v2/WorkAssistance.ts`) is limited to one project and environment, set by `MAIN_PROJECT` and `MAIN_ENVIRONMENT`. They are placeholder IDs here, so the feature does nothing until you put in your own.
- The phone and web apps from upstream don't have these changes. Per-device pins, for example, only fully apply to clients built from this repository.
- The Git config cache has been code reviewed but not yet run as part of a built app.

## What T3 Code is

T3 Code is an "agent harness control surface": one place to control the coding agents on your machine, from a desktop app, a web app or a phone. It works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity and fx. Install and sign in to at least one provider before use:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.
- fx: install [fx](https://fx.sh) and run `fx login` on the machine running the server ([setup guide](./docs/user/providers-fx.md))

For upstream's releases, apps, issues and community, see [pingdotgg/t3code](https://github.com/pingdotgg/t3code).

## Building from source

T3 Code uses Vite+, so you need the global `vp` command-line tool:

```bash
curl -fsSL https://vite.plus | bash
```

On Windows, in PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

Then install the dependencies:

```bash
vp i
```

Start at [docs/internals/overview.md](./docs/internals/overview.md) for how the pieces fit together and how to run and build them.

## Documentation

The docs live in [docs/](./docs):

- [FAQ](./docs/user/faq.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)
