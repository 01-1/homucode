import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import {
  AUTO_UPDATE_IDLE_MS,
  autoUpdateVersion,
  isAgentWorking,
  runAutoUpdate,
} from "./autoUpdateWhenIdle.logic";

// The update restarts this machine's server only, so only its agents keep it waiting.
const agentsWorkingAtom = Atom.make((get) => {
  const primary = get(primaryEnvironmentIdAtom);
  return (
    primary !== null &&
    get(environmentThreadShells.environmentThreadsAtom(primary)).some((thread) =>
      isAgentWorking(thread.status),
    )
  );
}).pipe(Atom.withLabel("desktop-auto-update-agents-working"));

const autoUpdateEnabledAtom = Atom.make((get) => {
  const primary = get(primaryEnvironmentIdAtom);
  const settings = primary === null ? null : get(serverEnvironment.settingsValueAtom(primary));
  return (settings ?? DEFAULT_SERVER_SETTINGS).autoUpdateWhenIdle;
}).pipe(Atom.withLabel("desktop-auto-update-enabled"));

const attempted = new Set<string>();

export function AutoUpdateWhenIdle() {
  const version = autoUpdateVersion(useDesktopUpdateState());
  const enabled = useAtomValue(autoUpdateEnabledAtom);
  const working = useAtomValue(agentsWorkingAtom);
  const idle = enabled && !working;
  const idlePeriod = useRef({ cancelled: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an in-flight install must see work start, outside React.
  useEffect(() => {
    if (!idle) return;
    const period = { cancelled: false };
    idlePeriod.current = period;
    return () => {
      period.cancelled = true;
    };
  }, [idle]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the idle timer and desktop updater live outside React.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!idle || version === null || attempted.has(version) || !bridge) return;
    // Only work, opting out or unmounting cancel an install; the updater's own downloading state does not.
    const period = idlePeriod.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      void runAutoUpdate({ bridge, attempted, isIdle: () => !period.cancelled })
        .then((outcome) => {
          if (typeof outcome === "object" && !stopped)
            timer = setTimeout(attempt, outcome.retryInMs);
        })
        .catch(() => {});
    };
    timer = setTimeout(attempt, AUTO_UPDATE_IDLE_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [idle, version]);

  return null;
}
