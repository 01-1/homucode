# App scripts

App scripts are small TypeScript files that drive the T3 Code window: open threads, start a new
thread with a prompt, send a message, run any keybinding command, or show a notice. You run them
with a keybinding, or from a terminal with `t3 app run`.

They are off by default. Turn them on in **Settings → Labs → App scripts**.

## The risk

A script can do anything you can do in the window, with no further prompt: start and message
agents, read your threads and projects, and press any shortcut. Only turn app scripts on if you
trust every file in the scripts folder. An agent that can write files on this machine can also
write a script there, which then runs the next time you press its keybinding.

Each switch is per device. None of them sync to your other devices, and no agent tool, scheduled
task or settings sync can turn them on.

## Write a script

Put scripts in the `scripts` folder of T3 Code's data folder, `~/.t3/userdata/scripts` by default.
The file name is the script's name: lowercase letters, digits and dashes, ending in `.ts`.

```ts
/// <reference path="./t3.d.ts" />

export default async (t3: T3App) => {
  const { project } = t3.current();
  if (!project) return t3.toast("Open a project first");
  await t3.newThread(project.id, { prompt: "Review today's changes", model: "claude-opus-5-5" });
};
```

After a script first runs, T3 Code writes `t3.d.ts` beside it with the full API, for editor
autocomplete. Types are removed when the script loads; they are not checked. Use only TypeScript
that can be erased, so no `enum` or `namespace`, and keep each script in one file without imports.

What a script returns is printed by `t3 app run` as JSON.

## Run a script with a keybinding

Bind a key to the command `user.<name>.run` in **Settings → Keybindings**, for example
`user.review-today.run` for `scripts/review-today.ts`. Scripts run in the desktop app and in a
browser opened on the same machine as T3 Code. A browser that reaches T3 Code over the network,
and the mobile app, cannot run them.

## Run a script from a terminal

Turn on **Run app scripts from the terminal** as well, then:

```sh
t3 app run review-today        # a script in the scripts folder
t3 app run ./one-off.ts        # any .ts file
```

This works only with the desktop app, from a terminal on the same machine, and not over SSH.

## Agents

With **Let agents run app scripts** off, the desktop app refuses `t3 app run` from an agent's
shell. It recognises one by the thread marker T3 Code puts in every agent's environment. This is
a guard against an agent running a script by mistake, not a sandbox: an agent that removes the
marker, or edits the settings file, can still get past it.
