# Homu Code

Homu Code is a fork of [T3 Code](https://github.com/pingdotgg/t3code), changed for running many coding agents at once. It has no releases or installers of its own: build it from source. Inside the app and the `t3` command it is still called T3 Code.

## Changes compared to T3 Code

The full list, with details, is in [CHANGES.md](./CHANGES.md). In short:

- **Server speed.** CLI calls no longer take the database write lock when there is nothing to migrate, work-assistance activity reads are about ten times cheaper, Git config reads are cached, and `T3CODE_BACKGROUND_GIT=0` switches off the server's own background Git work.
- **Threads and subagents.** Move threads under other threads, move or copy threads to projects on other devices, pinned subagents and sidebar folders, Stop that stops only the current thread, bare "stop" or "wait" messages that halt the running turn, settling a working thread files it when its turn ends, the sending device on each message, `/q` for a quick question on a cheaper model, `/cd` to move a thread to another folder, and opt-in autoreviewers.
- **Queue and steering.** Auto and steer delivery that steers as soon as the turn can take it, Ctrl+Enter to steer every queued message, and Claude steers that survive Stop.
- **Composer and messages.** A Claude Code style status line, sent messages as plain text, `+` kept at the start of a line, and answered questions that keep every option.
- **Desktop, CLI and mobile.** Settings sync across web, desktop and phone, faster CLI launches, Linux desktop link fixes, undo for a staged build, and smaller fixes.

Only builds from this repository have these changes; upstream's published apps don't. See [Known limits](./CHANGES.md#known-limits).

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
