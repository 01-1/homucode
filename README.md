# HomuCode

HomuCode is a fork of [T3 Code](https://github.com/pingdotgg/t3code), changed for running many coding agents at once. It has no releases or installers of its own: build it from source. Inside the app and the `t3` command it is still called T3 Code.

## Changes compared to T3 Code

The full list, with details, is in [CHANGES.md](./CHANGES.md). In short:

- **Server speed.** CLI calls no longer take the database write lock when there is nothing to migrate, work-assistance activity reads are about ten times cheaper, Git config reads are cached, Linux agent memory caps queue starts until there is room, opt-in 30-day T3 Connect passes avoid a cloud round trip on most launches, and a setting (or `T3CODE_BACKGROUND_GIT=0`) switches off the server's own background Git work.
- **Threads and subagents.** Move threads under other threads, move or copy threads to projects on other devices, pinned subagents and sidebar folders, sidebar search filters and sorting, Stop that stops only the current thread, opt-in bare "stop" or "wait" messages that halt the running turn, settling a working thread files it when its turn ends, every message marked as from a human (with device) or automatic (with its sender), `/q` for a quick question on a cheaper model, `/cd` to move a thread to another folder, a snooze menu with Custom… first and up to 16 options that can wake days ahead, approval prompts instead of refusals for project and environment changes below Full access, agent tools and `t3 thread organize` for the thread menu's remaining safe actions and Settings, and opt-in autoreviewers.
- **MadoHomu.** An opt-in Chat and Tasks view for one project with its own desktop app and an optional morning brief. [TODO: Rewrite because this is outdated]
- **Feature offers.** Setup offers the opt-in features on two pages, with HomuTheme preselected on first install, and users are shown a selection page with new features after an update.
- **Queue and steering.** Auto and steer delivery that steers as soon as the turn can take it, Ctrl+Enter to steer every queued message, resending of Claude steers that Stop left unread, opt-in model and effort changes that restart a running turn on the new setting, and messages sent while the previous one is still sending that wait and send themselves.
- **Composer and messages.** A Claude Code style status line, sent messages as plain text, `+` kept at the start of a line, answered questions that keep every option, and End to jump to the latest message.
- **Desktop, CLI and mobile.** Presses and keys dropped when they land just as the UI changed under them, opt-in settings sync across web, desktop and phone, opt-in TypeScript app scripts run from a keybinding or `t3 app run`, faster CLI launches, an opt-in phone launch that connects without waiting for sign-in, over-the-air Android updates, Linux desktop link fixes, undo for a staged build, app and provider updates once agents are idle, and smaller fixes.
- **Offloading to cloud.** Heavy checks and uncached Android dev clients run on Boat.
- **Add-ons.** Optional build tools in [`addons/`](./addons/README.md), all off by default. The optional Building T3 settings page runs cloud builds and staged-build loading with rollback, builds Android APKs and serves them on the LAN.

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
