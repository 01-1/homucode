import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
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
  const ready = enabled && !working && version !== null && !attempted.has(version);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the idle timer and desktop updater live outside React.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!ready || !bridge) return;
    const timer = setTimeout(() => {
      void runAutoUpdate({
        bridge,
        attempted,
        isIdle: () =>
          appAtomRegistry.get(autoUpdateEnabledAtom) && !appAtomRegistry.get(agentsWorkingAtom),
      }).catch(() => {});
    }, AUTO_UPDATE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  return null;
}
