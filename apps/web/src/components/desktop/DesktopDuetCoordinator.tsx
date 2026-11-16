import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { duetDestinationEnvironmentIdAtom } from "../../duet";
import { environmentServerConfigsAtom } from "../../state/server";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { toastManager } from "../ui/toast";

export function DesktopDuetCoordinator() {
  const destination = useAtomValue(duetDestinationEnvironmentIdAtom);
  const primary = usePrimaryEnvironmentId();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const environmentId = destination ?? primary ?? configs.keys().next().value ?? null;
  return environmentId ? <EnvironmentDuetCoordinator environmentId={environmentId} /> : null;
}

function EnvironmentDuetCoordinator({ environmentId }: { environmentId: EnvironmentId }) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const navigate = useNavigate();
  const bridge = window.desktopBridge;
  const enabled = settings?.duetEnabled;
  const launcherEnabled = settings?.duetDesktopAppEnabled;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the server's Duet opt-in to the Electron launcher and window service
  useEffect(() => {
    if (!bridge?.configureDuet || enabled === undefined) return;
    const isDuetWindow = bridge.isDuetWindow?.() === true;
    void bridge
      .configureDuet({
        enabled,
        launcherEnabled: launcherEnabled === true,
        // The Duet window's own destination can lag its route at startup; leave it to the main window.
        ...(isDuetWindow ? {} : { environmentId }),
      })
      .catch(() =>
        toastManager.add({ type: "error", title: "Could not update the Duet desktop app" }),
      );
  }, [bridge, enabled, launcherEnabled, environmentId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- receives navigation requested by the native merge and split window actions
  useEffect(
    () =>
      bridge?.onDuetNavigate?.((target) => {
        if (target.view === "code") void navigate({ to: "/" });
        else
          void navigate({
            to: "/duet",
            search: {
              ...(target.environmentId
                ? { environmentId: EnvironmentId.make(target.environmentId) }
                : {}),
              ...(target.threadId ? { threadId: ThreadId.make(target.threadId) } : {}),
              ...(target.tab ? { tab: target.tab } : {}),
            },
          });
      }),
    [bridge, navigate],
  );
  return null;
}
