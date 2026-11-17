import { describe, expect, it } from "vite-plus/test";

import { appScriptRunRefusal } from "./appScripts.ts";
import { DEFAULT_CLIENT_SETTINGS } from "./settings.ts";

const gates = (enabled: boolean, terminal: boolean, agents: boolean) => ({
  appScriptsEnabled: enabled,
  appScriptsFromTerminal: terminal,
  appScriptsFromAgents: agents,
});

describe("appScriptRunRefusal", () => {
  it("refuses everything with default settings or none", () => {
    for (const settings of [DEFAULT_CLIENT_SETTINGS, null]) {
      for (const source of ["keybinding", "terminal"] as const) {
        expect(appScriptRunRefusal(settings, { source, fromAgent: false })).toMatch(/are off/);
      }
    }
  });

  it.each([
    // enabled, terminal, agents, source, fromAgent, allowed
    [true, false, false, "keybinding", false, true],
    [true, false, false, "terminal", false, false],
    [false, true, true, "terminal", false, false],
    [true, true, false, "terminal", false, true],
    [true, true, false, "terminal", true, false],
    [true, true, true, "terminal", true, true],
    [true, false, true, "terminal", true, false],
  ] as const)(
    "enabled=%s terminal=%s agents=%s allows %s (agent=%s): %s",
    (enabled, terminal, agents, source, fromAgent, allowed) => {
      const refusal = appScriptRunRefusal(gates(enabled, terminal, agents), { source, fromAgent });
      expect(refusal === null).toBe(allowed);
    },
  );
});
