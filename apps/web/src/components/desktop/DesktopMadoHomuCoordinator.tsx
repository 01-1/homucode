import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { madohomuDestinationEnvironmentIdAtom } from "../../madohomu";
import { environmentServerConfigsAtom } from "../../state/server";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { toastManager } from "../ui/toast";

export function DesktopMadoHomuCoordinator() {
  const destination = useAtomValue(madohomuDestinationEnvironmentIdAtom);
  const primary = usePrimaryEnvironmentId();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const environmentId = destination ?? primary ?? configs.keys().next().value ?? null;
  return environmentId ? <EnvironmentMadoHomuCoordinator environmentId={environmentId} /> : null;
}

function EnvironmentMadoHomuCoordinator({ environmentId }: { environmentId: EnvironmentId }) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const navigate = useNavigate();
  const bridge = window.desktopBridge;
  const enabled = settings?.madohomuEnabled;
  const launcherEnabled = settings?.madohomuDesktopAppEnabled;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the server's MadoHomu opt-in to the Electron launcher and window service
  useEffect(() => {
    if (!bridge?.configureMadoHomu || enabled === undefined) return;
    const isMadoHomuWindow = bridge.isMadoHomuWindow?.() === true;
    void bridge
      .configureMadoHomu({
        enabled,
        launcherEnabled: launcherEnabled === true,
        // The MadoHomu window's own destination can lag its route at startup; leave it to the main window.
        ...(isMadoHomuWindow ? {} : { environmentId }),
      })
      .catch(() =>
        toastManager.add({ type: "error", title: "Could not update the MadoHomu desktop app" }),
      );
  }, [bridge, enabled, launcherEnabled, environmentId]);
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
