import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { pickIdleProviderUpdates } from "./ProviderIdleAutoUpdate.ts";

const MINUTE = 60_000;
const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");

const provider = (driver: ProviderDriverKind, latestVersion = "1.1.0"): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-17T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  versionAdvisory: {
    status: "behind_latest",
    currentVersion: "1.0.0",
    latestVersion,
    updateCommand: "npm install -g provider",
    canUpdate: true,
    checkedAt: "2026-11-17T00:00:00.000Z",
    message: "Update available.",
  },
});

it("updates a provider only after its own agents have been idle for five minutes, once per version", () => {
  const providers = [provider(codex), provider(claude)];
  const lastWorkingAt = new Map([
    [codex, 0],
    [claude, 0],
  ]);
  const attempted = new Set<string>();
  const runningCodex = [
    { status: "running" as const, providerInstanceId: providers[0]!.instanceId },
  ];
  const pick = (now: number, threads = runningCodex) =>
    pickIdleProviderUpdates({ providers, threads, lastWorkingAt, attempted, now }).map(
      (update) => update.driver,
    );

  expect(pick(4 * MINUTE)).toEqual([]);
  // Codex agents keep working, so only Claude updates.
  expect(pick(5 * MINUTE)).toEqual([claude]);
  expect(pick(6 * MINUTE, [])).toEqual([]);
  expect(pick(10 * MINUTE - 1, [])).toEqual([]);
  expect(pick(10 * MINUTE, [])).toEqual([codex]);
  expect(pick(20 * MINUTE, [])).toEqual([]);
  providers[1] = provider(claude, "1.2.0");
  expect(pick(21 * MINUTE, [])).toEqual([claude]);
});
