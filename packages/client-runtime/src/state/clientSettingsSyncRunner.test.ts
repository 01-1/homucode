import type { EnvironmentId } from "@t3tools/contracts";
import type { SyncedClientSettings } from "@t3tools/contracts/settings";
import { describe, expect, it } from "@effect/vitest";

import type { SyncedValues } from "./clientSettingsSync.ts";
import {
  type ClientSettingsSyncAdapter,
  createClientSettingsSyncRunner,
  settingsSyncTargets,
} from "./clientSettingsSyncRunner.ts";

/** A device connected to several servers, each holding its own synced copy. */
function device(input: {
  readonly local: SyncedValues;
  readonly servers: Record<string, SyncedClientSettings>;
  readonly bases?: Record<string, SyncedClientSettings>;
}) {
  const state = {
    local: { ...input.local },
    servers: { ...input.servers },
    bases: { ...input.bases },
  };
  const adapter: ClientSettingsSyncAdapter = {
    isReady: () => true,
    isEnabled: () => true,
    targets: () =>
      Object.entries(state.servers).map(([environmentId, remote]) => ({
        environmentId: environmentId as EnvironmentId,
        remote,
      })),
    readLocal: () => state.local,
    applyLocal: async (changed) => {
      state.local = { ...state.local, ...changed };
    },
    readBase: (environmentId) => state.bases[environmentId] ?? null,
    writeBase: (environmentId, base) => {
      state.bases[environmentId] = base;
    },
    writeRemote: async (environmentId, next) => {
      state.servers[environmentId] = next;
      return next;
    },
    onError: (error) => {
      throw error;
    },
  };
  return { state, runner: createClientSettingsSyncRunner(adapter) };
}

describe("createClientSettingsSyncRunner", () => {
  it("settles once synced when the server has settings this client does not have", async () => {
    const remote: SyncedClientSettings = {
      revision: 1,
      values: { wordWrap: false, sidebarWidth: 320 },
    };
    const local: SyncedValues = { wordWrap: false };
    let base: SyncedClientSettings | null = null;
    const calls = { applyLocal: 0, writeBase: 0, writeRemote: 0 };
    const runner = createClientSettingsSyncRunner({
      isReady: () => true,
      isEnabled: () => true,
      targets: () => [{ environmentId: "environment-1" as never, remote }],
      readLocal: () => local,
      applyLocal: async () => {
        calls.applyLocal += 1;
      },
      readBase: () => base,
      writeBase: (_environmentId, next) => {
        calls.writeBase += 1;
        base = next;
      },
      writeRemote: async () => {
        calls.writeRemote += 1;
        return null;
      },
      onError: (error) => {
        throw error;
      },
    });

    await runner.requestSync();
    await runner.requestSync();
    await runner.requestSync();

    expect(calls).toEqual({ applyLocal: 1, writeBase: 1, writeRemote: 0 });
  });

  it("carries a setting changed through one server to every other connected server", async () => {
    const synced: SyncedClientSettings = { revision: 1, values: { wordWrap: true } };
    const { state, runner } = device({
      local: { wordWrap: true },
      servers: { own: synced, other: { revision: 2, values: { wordWrap: false } } },
      bases: { own: synced, other: synced },
    });

    await runner.requestSync();
    await runner.requestSync();

    expect(state.local).toEqual({ wordWrap: false });
    expect(state.servers.own?.values).toEqual({ wordWrap: false });
    expect(runner.getPrompt()).toBeNull();
  });

  it("asks about one server at a time while the others keep syncing", async () => {
    const { state, runner } = device({
      local: { wordWrap: true, chatWidth: "wide" },
      servers: {
        first: { revision: 1, values: { wordWrap: false } },
        second: { revision: 1, values: { wordWrap: true, chatWidth: "narrow" } },
        caughtUp: { revision: 1, values: { wordWrap: true, chatWidth: "wide" } },
      },
      bases: { caughtUp: { revision: 1, values: { wordWrap: true, chatWidth: "normal" } } },
    });

    await runner.requestSync();
    expect(runner.getPrompt()).toMatchObject({ environmentId: "first", firstSetup: true });
    expect(state.bases.caughtUp?.values).toEqual({ wordWrap: true, chatWidth: "wide" });

    runner.resolvePrompt({ wordWrap: "local" });
    await runner.requestSync();
    expect(state.servers.first?.values).toEqual({ wordWrap: true, chatWidth: "wide" });
    expect(runner.getPrompt()).toMatchObject({
      environmentId: "second",
      conflicts: [{ key: "chatWidth", local: "wide", remote: "narrow" }],
    });

    runner.deferPrompt();
    state.servers.caughtUp = { revision: 2, values: { wordWrap: false, chatWidth: "wide" } };
    await runner.requestSync();
    expect(runner.getPrompt()).toBeNull();
    expect(state.local.wordWrap).toBe(false);
  });

  it("syncs only with eligible connected servers whose config has loaded", () => {
    const remote: SyncedClientSettings = { revision: 3, values: {} };
    const configs = new Map([
      ["live" as EnvironmentId, { settings: { syncedClientSettings: remote } }],
      ["offline" as EnvironmentId, { settings: { syncedClientSettings: remote } }],
      ["restricted" as EnvironmentId, { settings: { syncedClientSettings: remote } }],
    ]);
    expect(
      settingsSyncTargets(
        ["live", "loading", "restricted"] as EnvironmentId[],
        configs as unknown as Parameters<typeof settingsSyncTargets>[1],
        (environmentId) => environmentId !== "restricted",
      ),
    ).toEqual([{ environmentId: "live", remote }]);
  });
});
