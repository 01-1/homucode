import { useAtomValue } from "@effect/atom-react";
import {
  madoHomuProjectSelectionIssue,
  resolveMadoHomuDestination,
  writeMadoHomuProject,
} from "@t3tools/client-runtime/madohomu";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  projectEnvironmentPresentation,
  type EnvironmentPresentation,
} from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

const destinationAtom = Atom.make((get) => {
  const linked = [...get(environmentPresentations.presentationsAtom)]
    .filter(([, { entry }]) => entry.enabled && entry.unsupportedReason === undefined)
    .map(([id, presentation]) => projectEnvironmentPresentation(id, presentation));
  const destination = resolveMadoHomuDestination(
    linked.map(({ environmentId, serverConfig }) => ({
      environmentId,
      settings: serverConfig?.settings ?? null,
    })),
  );
  return { linked, destination };
});

const selectionPendingAtom = Atom.make(false).pipe(Atom.keepAlive);

export function useMadoHomuDestination() {
  return useAtomValue(destinationAtom);
}

function settingsHost(
  linked: readonly EnvironmentPresentation[],
  id: EnvironmentId,
  canWrite: () => boolean,
) {
  const host = linked.find((entry) => entry.environmentId === id);
  return host
    ? {
        label: host.label,
        connected: host.connection.phase === "connected",
        settingsLoaded: host.serverConfig !== null,
        canWrite: canWrite(),
      }
    : null;
}

export function useMadoHomuProjectSelection() {
  const { linked, destination } = useMadoHomuDestination();
  const writable = useEnvironmentsWithScope(linked, AuthSettingsWriteScope);
  const isSelecting = useAtomValue(selectionPendingAtom);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const selectionIssue = (id: EnvironmentId) =>
    madoHomuProjectSelectionIssue(destination, id, (hostId) =>
      settingsHost(linked, hostId, () => writable.has(hostId)),
    );
  const changeProject = async (project: ScopedProjectRef) => {
    if (appAtomRegistry.get(selectionPendingAtom)) return false;
    // Add Project can return much later, after a connection or destination has changed.
    const current = appAtomRegistry.get(destinationAtom);
    const readHost = (id: EnvironmentId) =>
      settingsHost(current.linked, id, () => readEnvironmentScope(id, AuthSettingsWriteScope));
    appAtomRegistry.set(selectionPendingAtom, true);
    return (async () => {
      try {
        await writeMadoHomuProject(
          current.destination,
          project,
          readHost,
          async (environmentId, patch) => {
            const result = await update({ environmentId, input: { patch } });
            if (result._tag === "Success") return result.value;
            throw squashAtomCommandFailure(result);
          },
        );
        return true;
      } catch (error) {
        Dialog.alert(
          "Could not change MadoHomu project",
          error instanceof Error ? error.message : String(error),
        );
        return false;
      }
    })().finally(() => appAtomRegistry.set(selectionPendingAtom, false));
  };
  return { linked, selectionIssue, isSelecting, changeProject };
}
