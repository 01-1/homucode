import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironmentPresentation } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  madoHomuProjectAnchor,
  resolveMadoHomuDestination,
  saveMadoHomuProject,
} from "./madohomuDestination";

const destinationAtom = Atom.make((get) => {
  const linked = [...get(environmentPresentations.presentationsAtom)]
    .filter(([, { entry }]) => entry.enabled && entry.unsupportedReason === undefined)
    .map(([id, presentation]) => projectEnvironmentPresentation(id, presentation));
  const primaryEnvironmentId =
    linked.find(({ entry }) => entry.target._tag === "PrimaryConnectionTarget")?.environmentId ??
    null;
  const candidates = linked.map(({ environmentId, serverConfig }) => ({
    environmentId,
    settings: serverConfig?.settings ?? null,
  }));
  return {
    linked,
    candidates,
    primaryEnvironmentId,
    destination: resolveMadoHomuDestination(candidates, primaryEnvironmentId),
  };
});

const selectionPendingAtom = Atom.make(false).pipe(Atom.keepAlive);

export function useMadoHomuDestination() {
  return useAtomValue(destinationAtom);
}

export function useMadoHomuProjectSelection(environmentId: EnvironmentId) {
  const { linked, destination } = useMadoHomuDestination();
  const writable = useEnvironmentsWithScope(linked, AuthSettingsWriteScope);
  const isSelecting = useAtomValue(selectionPendingAtom);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const eligible = useMemo(() => {
    const connectedWriters = linked.filter(
      ({ connection, serverConfig, environmentId }) =>
        connection.phase === "connected" && serverConfig !== null && writable.has(environmentId),
    );
    const connectedWriterIds = new Set(connectedWriters.map((entry) => entry.environmentId));
    return connectedWriters.filter((entry) => {
      const anchor = madoHomuProjectAnchor(destination, environmentId, entry.environmentId);
      return anchor === null || connectedWriterIds.has(anchor);
    });
  }, [linked, writable, destination, environmentId]);
  const changeProject = async (project: ScopedProjectRef) => {
    if (appAtomRegistry.get(selectionPendingAtom)) return false;
    // Add Project can return much later, after a connection or destination has changed.
    const current = appAtomRegistry.get(destinationAtom);
    const canWrite = (id: EnvironmentId) =>
      current.linked.some(
        ({ environmentId, serverConfig, connection }) =>
          environmentId === id && serverConfig !== null && connection.phase === "connected",
      ) && readEnvironmentScope(id, AuthSettingsWriteScope);
    const anchor = madoHomuProjectAnchor(current.destination, environmentId, project.environmentId);
    if (!canWrite(project.environmentId) || (anchor !== null && !canWrite(anchor))) {
      Dialog.alert(
        "Could not change MadoHomu project",
        "Connect to the project's machine and the machine that stores the destination with settings access.",
      );
      return false;
    }
    appAtomRegistry.set(selectionPendingAtom, true);
    try {
      return await saveMadoHomuProject(
        current.destination,
        environmentId,
        project,
        async (environmentId, patch) => {
          const result = await update({ environmentId, input: { patch } });
          if (
            result._tag === "Success" &&
            (patch.madohomuProjectId === undefined ||
              result.value.madohomuProjectId === patch.madohomuProjectId) &&
            (patch.madohomuEnabled === undefined ||
              result.value.madohomuEnabled === patch.madohomuEnabled) &&
            (patch.madohomuDestinationEnvironmentId === undefined ||
              result.value.madohomuDestinationEnvironmentId ===
                patch.madohomuDestinationEnvironmentId)
          ) {
            return true;
          }
          if (!isAtomCommandInterrupted(result)) {
            const label = current.linked.find(
              (host) => host.environmentId === environmentId,
            )?.label;
            const error =
              result._tag === "Failure"
                ? String(squashAtomCommandFailure(result))
                : "The machine did not save the requested settings.";
            const detail = label ? `${label}: ${error}` : error;
            Dialog.alert(
              "Could not change MadoHomu project",
              environmentId === project.environmentId
                ? detail
                : `The project was saved on its machine, but the launch destination could not be saved. ${detail}`,
            );
          }
          return false;
        },
      );
    } finally {
      appAtomRegistry.set(selectionPendingAtom, false);
    }
  };
  return { eligible, isSelecting, changeProject };
}
