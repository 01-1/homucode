import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "@effect/vitest";

import {
  clientSettingsPatchFromSyncedValues,
  describeSyncedSettingConflict,
  planClientSettingsSync,
  resolveClientSettingsSync,
  syncedValuesFromClientSettings,
} from "./clientSettingsSync.ts";

describe("planClientSettingsSync", () => {
  it("pushes this device's settings to a server that has none", () => {
    const local = { wordWrap: false };
    expect(
      planClientSettingsSync({ local, base: null, remote: { revision: 0, values: {} } }),
    ).toEqual({ merged: local, conflicts: [] });
  });

  it("asks on first setup about each setting that differs, and only those", () => {
    const plan = planClientSettingsSync({
      local: { wordWrap: false, chatWidth: "wide", diffLayout: "split" },
      base: null,
      remote: {
        revision: 3,
        values: { wordWrap: true, chatWidth: "wide", futureSetting: 1 },
      },
    });
    expect(plan.conflicts).toEqual([{ key: "wordWrap", local: false, remote: true }]);
    expect(plan.merged).toEqual({ chatWidth: "wide", diffLayout: "split", futureSetting: 1 });
  });

  it("merges changes made on one side and asks when both changed a setting", () => {
    const plan = planClientSettingsSync({
      local: { wordWrap: false, chatWidth: "wide", diffLayout: "stacked", fontSmoothing: true },
      base: {
        revision: 4,
        values: {
          wordWrap: true,
          chatWidth: "comfortable",
          diffLayout: "split",
          fontSmoothing: true,
        },
      },
      remote: {
        revision: 5,
        values: { wordWrap: true, chatWidth: "full", diffLayout: "stacked", fontSmoothing: false },
      },
    });
    expect(plan.merged).toEqual({ wordWrap: false, diffLayout: "stacked", fontSmoothing: false });
    expect(plan.conflicts).toEqual([{ key: "chatWidth", local: "wide", remote: "full" }]);
    expect(resolveClientSettingsSync(plan, {})).toBeUndefined();
    expect(resolveClientSettingsSync(plan, { chatWidth: "local" })).toEqual({
      ...plan.merged,
      chatWidth: "wide",
    });
  });

  it("compares objects regardless of key order", () => {
    const plan = planClientSettingsSync({
      local: { threadDetailsItems: { a: true, b: false } },
      base: null,
      remote: { revision: 1, values: { threadDetailsItems: { b: false, a: true } } },
    });
    expect(plan.conflicts).toEqual([]);
  });
});

describe("synced client setting values", () => {
  it("leaves device settings out and skips values this client cannot decode", () => {
    const values = syncedValuesFromClientSettings({
      ...DEFAULT_CLIENT_SETTINGS,
      settingsSyncEnabled: false,
      onboardingCompletedAt: "2026-11-16T00:00:00.000Z",
    });
    expect(values).not.toHaveProperty("settingsSyncEnabled");
    expect(values).not.toHaveProperty("onboardingCompletedAt");
    expect(values).toHaveProperty("wordWrap", true);
    expect(
      clientSettingsPatchFromSyncedValues({
        wordWrap: false,
        chatWidth: "not-a-width",
        settingsSyncEnabled: false,
        futureSetting: 1,
      }),
    ).toEqual({ wordWrap: false });
  });

  it("never syncs the app script gates in either direction", () => {
    const gates = {
      appScriptsEnabled: true,
      appScriptsFromTerminal: true,
      appScriptsFromAgents: true,
    };
    const values = syncedValuesFromClientSettings({ ...DEFAULT_CLIENT_SETTINGS, ...gates });
    for (const key of Object.keys(gates)) expect(values).not.toHaveProperty(key);
    expect(clientSettingsPatchFromSyncedValues(gates)).toEqual({});
  });

  it("describes conflicting lists by what differs instead of raw JSON", () => {
    const shared = { provider: "claudeAgent", model: "claude-opus-5-5" };
    expect(
      describeSyncedSettingConflict({
        key: "favorites",
        local: [shared, { provider: "claudeAgent", model: "claude-fable-5-2" }],
        remote: [shared, { provider: "codex", model: "gpt-6.2-sol" }],
      }),
    ).toEqual({ local: "2 items, incl. claude-fable-5-2", remote: "2 items, incl. gpt-6.2-sol" });
    expect(
      describeSyncedSettingConflict({ key: "favorites", local: ["a", "b"], remote: ["b", "a"] }),
    ).toEqual({ local: "2 items, different order", remote: "2 items, different order" });
    expect(
      describeSyncedSettingConflict({ key: "theme", local: "lavender-darker", remote: "lavender" }),
    ).toEqual({ local: "lavender-darker", remote: "lavender" });
  });
});
