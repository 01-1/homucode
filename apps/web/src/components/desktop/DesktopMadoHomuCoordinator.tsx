import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  madohomuDefaultEnvironmentIdAtom,
  madohomuSavedDestinationEnvironmentIdAtom,
} from "../../madohomu";
import { environmentServerConfigsAtom } from "../../state/server";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { expectsPrimaryEnvironment } from "../../state/shell";
import { toastManager } from "../ui/toast";

export function DesktopMadoHomuCoordinator() {
  const environmentId = useAtomValue(madohomuDefaultEnvironmentIdAtom);
  const saved = useAtomValue(madohomuSavedDestinationEnvironmentIdAtom);
  const primary = usePrimaryEnvironmentId();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const settings = environmentId === null ? undefined : configs.get(environmentId)?.settings;
  const ready = !expectsPrimaryEnvironment() || (primary !== null && configs.has(primary));
  const navigate = useNavigate();
  const bridge = window.desktopBridge;
  const enabled = settings?.madohomuEnabled ?? (saved === null ? undefined : true);
  const launcherEnabled = settings?.madohomuDesktopAppEnabled === true;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the server's MadoHomu opt-in to the Electron launcher and window service
  useEffect(() => {
    if (
      !ready ||
      !bridge?.configureMadoHomu ||
      bridge.isMadoHomuWindow?.() ||
      enabled === undefined
    )
      return;
    void bridge
      .configureMadoHomu({ enabled, launcherEnabled, environmentId })
      .catch(() =>
        toastManager.add({ type: "error", title: "Could not update the MadoHomu desktop app" }),
      );
  }, [bridge, enabled, launcherEnabled, environmentId, ready]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- receives navigation requested by the native merge and split window actions
  useEffect(
    () =>
      bridge?.onMadoHomuNavigate?.((target) => {
        if (target.view === "code") void navigate({ to: "/" });
        else
          void navigate({
            to: "/madohomu",
            search: {
              ...(target.environmentId
                ? { environmentId: EnvironmentId.make(target.environmentId) }
                : {}),
              ...(target.threadId ? { threadId: ThreadId.make(target.threadId) } : {}),
            },
          });
      }),
    [bridge, navigate],
  );
  return null;
}
