#!/usr/bin/env bash
# Run on omen as @01-1: opens each upstream issue, then a draft PR from homura-ai/homucode that fixes it.
set -euo pipefail
R=pingdotgg/t3code

# --- connect-signed-out
connect_signed_out_issue=$(gh issue create -R $R --title '[Bug]: A signed-out device says "still loading its T3 Connect sign-in" and retries forever' --body-file - <<'EOF_ISSUE'
> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of @01-1**

### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

Related, but with different causes: #37602 (stuck after launching offline) and #29337 (session pending on Windows, closed as a duplicate). Here Clerk has loaded and there is no account, and the client never tells those two cases apart.

### Area

packages/client-runtime (web, desktop and mobile all use it)

### What happens

A device that is not signed in to T3 Connect, with a saved T3 Connect environment, shows "This device is still loading its T3 Connect sign-in" with the steps "Wait a moment. T3 Code retries on its own." It keeps retrying with `session_pending` forever. Waiting or reloading doesn't help, because nothing is loading: the device is signed out. Nothing tells the user that signing in is the fix.

### Steps to reproduce

1. On a device that has a saved T3 Connect (relay) environment, sign out of the T3 account, or open the app on a device that was never signed in.
2. Open that environment, or a thread on it.
3. Look at the connection banner or Connection Details.

### Expected behavior

Once Clerk has loaded and found no account, the device says it is not signed in to T3 Connect and asks you to sign in. It reconnects after you sign in.

### Actual behavior

It shows "This device is still loading its T3 Connect sign-in", the attempt fails with `ConnectionTransientError` / `session_pending` ("Waiting for the T3 Connect sign-in to load."), and the retries never stop.

### Cause

`packages/client-runtime/src/authorization/service.ts` (around line 411 on `main` at d7373c44fe) returns `sessionPending()` whenever `cloudSession.identity` is `None`. `None` means both "Clerk has not loaded yet" and "Clerk loaded and there is no account". The cloud account service knows when a real sign-out has happened (its `SignOut` step), but it calls `deactivate()` without saying so, so the authorization layer can't tell the two apart.

### Version or commit

`main` at d7373c44feaa85f561c0f1e829ea1c31918acbeb. I first saw this in HomuCode, a fork, where this code path is the same as upstream's.

### Environment

Any client that uses T3 Connect: web, desktop and mobile share this path in `client-runtime`.

### Evidence

A unit test against `main` (`RemoteEnvironmentAuthorization` in `packages/client-runtime/src/authorization/layer.test.ts`) with no session and the account service reporting a sign-out:

```
AssertionError: expected ConnectionTransientError: Waiting for the… to match object
- "_tag": "ConnectionBlockedError",
- "failureCause": "signed_out",
+ "_tag": "ConnectionTransientError",
```

A fix with tests is ready as a PR.
EOF_ISSUE
)
n=${connect_signed_out_issue##*/}; echo "issue: $connect_signed_out_issue"
gh pr create -R $R --draft --base main --head homura-ai:upstream/fix-connect-signed-out-wait --title 'fix(client-runtime): a signed-out device asks to sign in to T3 Connect instead of waiting forever' --body-file - <<EOF_PR
> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of @01-1**

# fix(client-runtime): a signed-out device asks to sign in to T3 Connect instead of waiting forever

Fixes #$n

## Problem

A device with no T3 Connect session showed "This device is still loading its T3 Connect sign-in" and retried forever, even after Clerk had loaded and found no account. Authorization returned \`sessionPending()\` whenever the cloud session identity was missing, so a device that was signed out looked the same as one whose sign-in was still loading.

## Fix

- The cloud account service tells its \`deactivate\` handler whether this is a real sign-out (\`signedOut: true\`) or a switch to another account (\`signedOut: false\`).
- \`setManagedRelaySession\` sets a new \`managedRelaySignedOutAtom\` only when the session is cleared by a real sign-out. Setting a session, or clearing it any other way (detach, account switch), resets it to false. Before Clerk loads, it is false, so that case still shows "pending".
- \`CloudSession\` gains \`signedOut\`. Web and mobile read it from the atom.
- With no identity and \`signedOut\` true, remote authorization fails with \`ConnectionBlockedError\` (\`hop: "device"\`, \`failureCause: "signed_out"\`) instead of \`sessionPending()\`.
- The connection diagnosis shows "This device is not signed in to T3 Connect", with sign-in steps and a link to the sign-in section of the troubleshooting page. \`docs/user/t3-connect-troubleshooting.md\` gets a matching line.
- Mobile builds without cloud config deactivate with \`signedOut: true\`, since no account can ever sign in there.

## Evidence

New and updated tests, each run alone (\`vp test run <file> --maxWorkers=1\`):

| Test | \`main\` source | This PR |
|---|---|---|
| \`authorization/layer.test.ts\` › asks for a sign-in instead of retrying once this device is signed out | fails: got \`ConnectionTransientError\` ("Waiting for the T3 Connect sign-in to load.") | passes (29/29 in file) |
| \`connection/diagnosis.test.ts\` › tells a signed-out device to sign in instead of waiting for the sign-in to load | fails: \`Schema validation failed\` (\`signed_out\` is not a \`ConnectionFailureCause\`) | passes (11/11) |
| \`relay/cloudAccountService.test.ts\` › three existing cases now check the \`signedOut\` flag passed to \`deactivate\` | 3 fail | passes (9/9) |

\`remote.test.ts\`, \`supervisor.test.ts\` and \`discovery.test.ts\` only add \`signedOut: Effect.succeed(false)\` to their \`CloudSession\` fakes.

## Not checked

- I didn't run typecheck, lint or the full suites locally; CI runs them.
- I didn't check it by hand in a running web, desktop or mobile client. The proof is the unit tests above.
- I didn't test the reconnect after signing in end to end. It relies on existing code: a blocked supervisor waits for any signal, and signing in changes the account id, which sends a \`credentials-changed\` wakeup (\`managedRelayAccountChanges\` in the web and mobile platform layers).

Created with Claude Opus 5.5 in Claude Code
EOF_PR

# --- queued-steer
queued_steer_issue=$(gh issue create -R $R --title "A send in auto mode waits for the whole turn when the turn hasn't started yet" --body-file - <<'EOF_ISSUE'
> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of @01-1**

### What happens

A message sent in auto mode (the composer's default Enter, or an agent's `t3_thread_send` with `mode: "auto"`) is supposed to steer the running turn when the provider can steer. If it arrives while the run is still preparing, starting (worktree setup, session start), or waiting for its provider turn to start, it is queued as an ordinary next message instead. It then waits for the whole turn to finish, or for someone to press "Send now".

An explicit Steer sent in the same window already works: since #34581 it is held and delivered as soon as the provider turn starts. Only auto mode misses this.

### Steps

1. Use a provider that supports steering an active turn (Codex or Claude).
2. Send a message that starts a run with some setup time, for example in a new worktree thread.
3. While the run shows as preparing or starting, before the agent's turn begins, send a second message with plain Enter (or `t3_thread_send` with mode `auto`).
4. Watch the second message.

### Expected

The second message steers into the turn as soon as the turn starts, the same as pressing Steer.

### Actual

The second message sits in the queue until the first turn has fully finished, then runs as its own turn.

### Cause

`resolveDeliveryIntent` in `apps/server/src/orchestration-v2/CommandPolicy.ts` returns `queue_after_active` for auto mode while the run is preparing, starting, or has no running provider turn ("Queue automatic input in those gaps so steering cannot reject the message"). The Orchestrator only defers a steer (`steerWhenReadyRunId`) when the resolved mode is `steer_active`, which happens for explicit `steer` but never for `auto` in that gap.

### Evidence

In `SteeringCompletion.integration.test.ts`, adding `deliveryIntent: "auto"` rows to the existing "delivers a deferred steer for a $status run" table makes all three new rows (preparing, starting, running with a pending turn) fail on `main`. The auto send is queued with the queue's model selection and not deferred into the run. The existing no-intent and `steer` rows pass.
EOF_ISSUE
)
n=${queued_steer_issue##*/}; echo "issue: $queued_steer_issue"
gh pr create -R $R --draft --base main --head homura-ai:upstream/fix-queued-steer-sends --title 'fix(server): steer automatic sends that arrive before the turn starts' --body-file - <<EOF_PR
> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of @01-1**

**Title:** fix(server): steer automatic sends that arrive before the turn starts

Fixes #$n.

An auto-mode send (the composer's default Enter, or \`t3_thread_send\` mode \`auto\`) that reaches a run still preparing, starting, or waiting for its provider turn is queued as a plain next turn, so it waits for the whole turn. An explicit Steer in the same window is already deferred and delivered when the turn starts (#34581).

### Fix

In \`dispatchMessage\`, when an auto send resolved to \`queue_after_active\` because the active run's provider turn hasn't started (run preparing or starting, or running with no turn or only a pending turn for its attempt), and the provider can steer an active turn, it is treated as a steer. The existing \`steerWhenReadyRunId\` path then defers it and delivers it when the turn starts. The new condition is a subset of that path's gap check, so it never reaches the immediate steer.

These sends still queue as before: compaction and sign-out (as either the target or the message), goal commands, fresh-context sends, notifications and delegated completions, runs that Stop has reached, providers that can't steer an active turn, and sends after the turn has already completed.

Change: \`apps/server/src/orchestration-v2/Orchestrator.ts\` (+38). Test: 3 rows added to an existing table (+7/−3).

### Evidence

\`SteeringCompletion.integration.test.ts\`, "delivers a deferred steer for a \$status run", now runs each status with no intent, \`steer\`, and \`auto\`.

Before the fix (\`main\`):

\`\`\`
   × delivers a deferred steer for a preparing run (intent: auto)
   × delivers a deferred steer for a starting run (intent: auto)
   × delivers a deferred steer for a running run (intent: auto)
AssertionError: expected { instanceId: 'codex', …(2) } to deeply equal { instanceId: 'codex', …(2) }
      Tests  3 failed | 6 passed | 58 skipped (67)
\`\`\`

After:

\`\`\`
      Tests  9 passed | 58 skipped (67)
\`\`\`

Whole files after the fix: \`SteeringCompletion.integration.test.ts\` 67/67, \`runtimeLayer.test.ts\` 181/181, \`testkit/ProviderSwitch.integration.test.ts\` 69/69.

### Not checked

- No typecheck, full suite or \`vp run check:changed\` run locally; left to CI.
- Not tried in a running app with a real provider.
- Providers that steer only by interrupt and restart stay queued for auto sends in this window, as before.

Created with Claude Opus 5.5 in Claude Code
EOF_PR

# --- theme-tweak
theme_tweak_issue=$(gh issue create -R $R --title 'Asking an agent to change a few theme colors restyles the whole app' --body-file - <<'EOF_ISSUE'
> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of @01-1**

**Area:** apps/server

## Steps to reproduce

1. Use T3 Code on the stock theme, with no environment theme set on the server (`t3 theme show` says "not set").
2. In a Full access thread, ask the agent: "Make T3 Code itself a bit darker in just two places: the composer and my message bubbles. Leave everything else in the app looking the way it does now."

## Expected behavior

Only the composer and the user message bubbles get darker. Everything else stays the stock theme.

## Actual behavior

The agent publishes a theme that sets only the roles it was asked about, or only CSS. In practice:

- `t3_theme_read` returns `current: ""`. Agents read that as "no theme".
- `t3_theme_read` with `themeId: "t3-code"` (or any built-in id) fails with "is not a published theme", so the agent has no way to get the colors the app shows now.
- A published theme fills every role it leaves out from the T3 Chat palette (`getDefaultThemeColors` in `apps/web/src/themePalette.ts`), not from the theme the user was on. So publishing two colors swaps nearly the whole app to T3 Chat colors.
- A CSS-only file is refused ("has no colors"), and the agent's next try adds a couple of colors, which lands in the case above.

The theme guide doesn't say that a published theme replaces the current one entirely, so nothing steers the agent away from a partial file.

## Impact

Minor bug or occasional failure. The user's whole look changes when they asked for two tweaks. They can undo it by setting `t3-code` again, if they know that id.

## Evidence

An eval case in `evals/mcp-tool-use` with the read result `main` returns today (`current: ""`, the current guide), GPT-6.1 Sol, 3 samples: 0 of 3 kept the rest of the theme. All three published a dark-appearance theme with only CSS for the composer and bubbles and no color roles. One sample tried `t3_theme_read` with `themeId: "t3-code"` first and got nothing back to start from.

## Version or commit

`main` at d7373c44fe.

## Workaround

Ask the agent to set `t3-code` again to undo it. To get a tweak that keeps the rest, give the agent the full list of current colors yourself.
EOF_ISSUE
)
n=${theme_tweak_issue##*/}; echo "issue: $theme_tweak_issue"
gh pr create -R $R --draft --base main --head homura-ai:upstream/fix-theme-tweak-keeps-theme --title 'fix(server): theme tweaks from agents keep the rest of the current theme' --body-file - <<EOF_PR
> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of @01-1**

# fix(server): theme tweaks from agents keep the rest of the current theme

Branch: \`upstream/fix-theme-tweak-keeps-theme\` (base: pingdotgg/t3code \`main\` at d7373c44fe)

## Problem

Asked to change a few colors, such as "darken only the composer and my message bubbles", agents publish a theme with only those colors. \`t3_theme_read\` reports \`current: ""\` when the server sets no theme and can't return a built-in theme's file, so the agent has nothing to start from. Every role the file leaves out comes from the T3 Chat palette, so nearly the whole app changes. Fixes #$n.

## Change

- \`t3_theme_read\` reports \`current: "t3-code"\` when the server has no theme set. When no theme was ever set, it adds a \`note\` saying each device shows its own choice, the stock theme unless the user picked another on that device.
- \`t3_theme_read\` with \`themeId\` now returns built-in theme files (\`t3-code\` and the five built-ins) as well as published ones, so an agent can publish a changed copy. The \`t3-code\` file uses the colors web actually paints for the stock theme (dark canvas \`#000000\`, its own bubble colors), so a copy doesn't shift the background. Those overrides moved from \`apps/web/src/themePalette.ts\` to \`packages/shared/src/themePalettes.ts\` so web and server share one copy.
- The theme guide says a published theme replaces the current one: roles it leaves out come from a generic palette and the current CSS is not kept. It tells the agent to read the current theme's file, change only what was asked, and publish the whole file. The undo line now says to set the theme that was \`current\` before.
- \`docs/user/appearance.md\` says a small change keeps the rest of the theme.
- New eval case \`tweak-current-theme-keeps-the-rest\`.

I considered a \`base\` option on \`t3_theme_set\` that would merge the new file over an existing theme. The eval showed the read-side fix alone was enough, so this PR leaves it out.

## Scope

Bug fix: asking for a small change restyles the whole app. Issue: #$n.

## Verification

- \`apps/server/src/environmentTheme.test.ts\`: the new case "reads the stock theme when none is set, and returns built-in theme files" fails on \`main\` (\`current\` is \`""\`) and passes with the fix. The file passes 13 of 13. \`handlers.test.ts\`, \`advertisedJsonSchema.test.ts\` and \`apps/web/src/themePalette.test.ts\` pass.
- Eval, \`evals/mcp-tool-use\`, GPT-6.1 Sol, 3 samples each:
  - \`tweak-current-theme-keeps-the-rest\` with \`main\`'s tool text and read result: 0 of 3. Every sample published a CSS-only or partial file.
  - The same case with this change: 3 of 3, on two separate runs. Every sample read \`t3-code\`, then published all 61 roles, the dark variant, and CSS for the composer and bubbles.
  - The other four theme cases still pass 3 of 3 each.
- Pre-commit hooks pass: \`vp fmt\`, \`vp lint\`, \`vp run knip:check\`.

Not checked:

- No typecheck or \`vp run check:changed\` run.
- Not tried in a running app. The evidence is the unit test and the eval, where tool results are mocks shaped like the real ones.
- Only Codex models were evaluated; no Claude model was run.
- The server can't see a device's local theme. When no theme is set and the user picked a different theme on their own device, the agent still starts from \`t3-code\`. The \`note\` tells the agent about this.

Created with Claude Opus 5.5 in Claude Code
EOF_PR

