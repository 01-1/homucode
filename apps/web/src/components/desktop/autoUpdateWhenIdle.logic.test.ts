import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { autoUpdateVersion, runAutoUpdate } from "./autoUpdateWhenIdle.logic";

const available: DesktopUpdateState = {
  enabled: true,
  status: "available",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: "1.1.0",
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
const downloaded: DesktopUpdateState = {
  ...available,
  status: "downloaded",
  downloadedVersion: "1.1.0",
};
const result = (state: DesktopUpdateState): DesktopUpdateActionResult => ({
  accepted: true,
  completed: true,
  state,
});

function bridge(state: DesktopUpdateState, idleSeconds = 600) {
  return {
    getSystemIdleSeconds: vi.fn(async () => idleSeconds),
    getUpdateState: vi.fn(async () => state),
    downloadUpdate: vi.fn(async () => result(downloaded)),
    installUpdate: vi.fn(async (_version?: string) => result(downloaded)),
  };
}

it("downloads then installs the update, and tries each version once", async () => {
  const fake = bridge(available);
  const attempted = new Set<string>();
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => true })).toBe("installed");
  expect(fake.downloadUpdate).toHaveBeenCalledOnce();
  expect(fake.installUpdate).toHaveBeenCalledWith("1.1.0");
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => true })).toBe("skipped");
  expect(fake.installUpdate).toHaveBeenCalledOnce();
});

it("does not install when an agent starts during the download", async () => {
  const fake = bridge(available);
  const attempted = new Set<string>();
  let idle = true;
  fake.downloadUpdate.mockImplementation(async () => {
    idle = false;
    return result(downloaded);
  });
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => idle })).toBe("skipped");
  expect(fake.installUpdate).not.toHaveBeenCalled();
  expect(attempted.size).toBe(0);
});

it("waits for five minutes without keyboard or mouse input, before and after the download", async () => {
  const fake = bridge(available, 120);
  const attempted = new Set<string>();
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => true })).toEqual({
    retryInMs: 180_000,
  });
  expect(fake.downloadUpdate).not.toHaveBeenCalled();

  fake.getSystemIdleSeconds.mockResolvedValueOnce(300).mockResolvedValueOnce(10);
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => true })).toEqual({
    retryInMs: 290_000,
  });
  expect(fake.installUpdate).not.toHaveBeenCalled();
  expect(attempted.size).toBe(0);
});

it("does not install when an agent starts while input is being read", async () => {
  const fake = bridge(downloaded);
  const attempted = new Set<string>();
  let idle = true;
  fake.getSystemIdleSeconds.mockResolvedValueOnce(600).mockImplementationOnce(async () => {
    idle = false;
    return 600;
  });
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => idle })).toBe("skipped");
  expect(fake.installUpdate).not.toHaveBeenCalled();
  expect(attempted.size).toBe(0);
});

it("retries later instead of giving up when input can't be read", async () => {
  const fake = bridge(downloaded);
  const attempted = new Set<string>();
  fake.getSystemIdleSeconds.mockResolvedValueOnce(600).mockRejectedValueOnce(new Error("ipc"));
  expect(await runAutoUpdate({ bridge: fake, attempted, isIdle: () => true })).toEqual({
    retryInMs: 300_000,
  });
  expect(attempted.size).toBe(0);
});

it("leaves a build that restarted without applying to a manual retry", () => {
  expect(autoUpdateVersion(downloaded)).toBe("1.1.0");
  expect(autoUpdateVersion({ ...downloaded, notAppliedVersion: "1.1.0" })).toBeNull();
});
