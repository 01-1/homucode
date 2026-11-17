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

/**
 * Downloads the update if needed, then installs it while agents are still idle.
 * Each version gets one attempt per session, so a failing install does not retry every few minutes.
 */
export async function runAutoUpdate(input: {
  readonly bridge: Pick<DesktopBridge, "getUpdateState" | "downloadUpdate" | "installUpdate">;
  readonly isIdle: () => boolean;
  readonly attempted: Set<string>;
}): Promise<"installed" | "skipped"> {
  const { bridge, isIdle, attempted } = input;
  const state = await bridge.getUpdateState();
  const version = autoUpdateVersion(state);
  if (version === null || attempted.has(version) || !isIdle()) return "skipped";
  attempted.add(version);
  if (resolveDesktopUpdateButtonAction(state) === "download") {
    const download = await bridge.downloadUpdate();
    if (!download.completed) return "skipped";
  }
  if (!isIdle()) {
    attempted.delete(version);
    return "skipped";
  }
  return (await bridge.installUpdate(version)).accepted ? "installed" : "skipped";
}
