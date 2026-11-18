import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";

import {
  getDesktopUpdateDownloadedVersion,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";

export const AUTO_UPDATE_IDLE_MS = 5 * 60_000;

const WORKING_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

export const isAgentWorking = (status: string) => WORKING_STATUSES.has(status);

/** The version an idle auto-update would install, or null when there is nothing to do. */
export function autoUpdateVersion(state: DesktopUpdateState | null): string | null {
  if (!state || resolveDesktopUpdateButtonAction(state) === "none") return null;
  const version = getDesktopUpdateDownloadedVersion(state);
  // A build that restarted without applying stays a manual retry, or it would restart every session.
  return version === state.notAppliedVersion ? null : version;
}

export type AutoUpdateOutcome = "installed" | "skipped" | { readonly retryInMs: number };

type AutoUpdateBridge = Pick<
  DesktopBridge,
  "getUpdateState" | "downloadUpdate" | "installUpdate" | "getSystemIdleSeconds"
>;

const humanWaitMs = async (bridge: AutoUpdateBridge) =>
  Math.max(0, AUTO_UPDATE_IDLE_MS - (await bridge.getSystemIdleSeconds()) * 1000);

/**
 * Downloads the update if needed, then installs it while agents and the human are still idle.
 * Each version gets one attempt per session, so a failing install does not retry every few minutes.
 * Recent keyboard or mouse input returns how long to wait before trying again.
 */
export async function runAutoUpdate(input: {
  readonly bridge: AutoUpdateBridge;
  readonly isIdle: () => boolean;
  readonly attempted: Set<string>;
}): Promise<AutoUpdateOutcome> {
  const { bridge, isIdle, attempted } = input;
  const state = await bridge.getUpdateState();
  const version = autoUpdateVersion(state);
  if (version === null || attempted.has(version) || !isIdle()) return "skipped";
  const wait = await humanWaitMs(bridge);
  if (wait > 0) return { retryInMs: wait };
  attempted.add(version);
  if (resolveDesktopUpdateButtonAction(state) === "download") {
    const download = await bridge.downloadUpdate();
    if (!download.completed) return "skipped";
  }
  if (!isIdle()) {
    attempted.delete(version);
    return "skipped";
  }
  const waitAfterDownload = await humanWaitMs(bridge);
  if (waitAfterDownload > 0) {
    attempted.delete(version);
    return { retryInMs: waitAfterDownload };
  }
  return (await bridge.installUpdate(version)).accepted ? "installed" : "skipped";
}
