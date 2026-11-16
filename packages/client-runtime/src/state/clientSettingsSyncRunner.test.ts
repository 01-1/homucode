import type { SyncedClientSettings } from "@t3tools/contracts/settings";
import { describe, expect, it } from "@effect/vitest";

import type { SyncedValues } from "./clientSettingsSync.ts";
import { createClientSettingsSyncRunner } from "./clientSettingsSyncRunner.ts";

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
      target: () => ({ environmentId: "environment-1" as never, remote }),
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
});
