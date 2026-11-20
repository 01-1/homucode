import { m } from "~/i18n/messages";
import { msg, T, useGT } from "gt-react";
import { getBuildToolsUnavailableReason } from "@t3tools/client-runtime/feature-offers";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomValue } from "@effect/atom-react";
import { useAtomCommand } from "../../state/use-atom-command";
import type { DesktopStagedBuildsState, EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const stagedBuilds = () =>
  typeof window === "undefined" ? undefined : window.desktopBridge?.stagedBuilds;

const stagedBuildsStateAtom = Atom.make(
  Effect.promise(
    async (): Promise<DesktopStagedBuildsState | null> =>
      (await stagedBuilds()?.getState()) ?? null,
  ),
).pipe(
  Atom.swr({ staleTime: 0, revalidateOnMount: true }),
  Atom.withLabel("desktop:staged-builds:load"),
);

const refresh = () => appAtomRegistry.refresh(stagedBuildsStateAtom);

const failureToast = (title: string, error: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : m(msg("Something went wrong.")),
    }),
  );

/** Undoes the last staged AppImage, so the next start loads the build staged before it. */
export function StagedBuildSettingsRow({
  environmentId,
}: { readonly environmentId?: EnvironmentId } = {}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const bridge = stagedBuilds();
  const query = useEnvironmentQuery(bridge ? stagedBuildsStateAtom : null);
  const environment = useEnvironment(environmentId ?? null);
  const canWrite = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId ?? null),
  );
  const reason = getBuildToolsUnavailableReason(environment?.serverConfig?.environment, canWrite);
  const remote = useEnvironmentQuery(
    environmentId && !reason
      ? serverEnvironment.buildToolsState({ environmentId, input: {} })
      : null,
  );
  const run = useAtomCommand(serverEnvironment.buildToolsRun);
  const canRun = useAtomValue(
    serverEnvironment.buildToolsRun.permissionAtom(environmentId ?? null),
  );
  const remoteAction = async (action: "undo" | "redo", undoneAs = "") => {
    if (!environmentId || reason || !canRun || remote.error) return null;
    const result = await run({
      environmentId,
      input: { action, undoneAs, ref: "origin/main", testFiles: [], stagedFile: "", sha256: "" },
    });
    return result._tag === "Success" ? result.value : null;
  };
  const [pending, setPending] = useState(false);
  const state = environmentId ? remote.data?.stagedBuilds : query.data;
  if (environmentId && (reason || remote.error))
    return <p className="text-sm text-muted-foreground">{reason ?? remote.error}</p>;
  if (!state)
    return environmentId ? (
      <p className="text-sm text-muted-foreground">
        <T>Staged builds are not available on this installation.</T>
      </p>
    ) : null;

  const redo = (undoneAs: string) => {
    if (environmentId) {
      void remoteAction("redo", undoneAs);
      return;
    }
    void bridge!
      .redo(undoneAs)
      .then(refresh)
      .catch((error: unknown) => failureToast(m(msg("Could not redo the staged build")), error));
  };

  const undo = () => {
    setPending(true);
    const operation = environmentId
      ? remoteAction("undo").then((result) => {
          if (!result?.stagedBuilds || !result.undoneAs)
            throw new Error("Could not undo this build.");
          return { state: result.stagedBuilds, undoneAs: result.undoneAs };
        })
      : bridge!.undo();
    void operation
      .then(({ state: after, undoneAs }) => {
        refresh();
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: gt("Undid the staged build"),
            description: gt("The next start loads {build}.", { build: after.next }),
            actionProps: {
              children: gt("Redo", { $context: "verb, reapply a staged build" }),
              onClick: () => redo(undoneAs),
            },
          }),
        );
      })
      .catch((error: unknown) => failureToast(m(msg("Could not undo the staged build")), error))
      .finally(() => setPending(false));
  };

  const loads =
    state.next === state.running
      ? gt("The next start loads this running build, {build}.", { build: state.next })
      : gt("The next start loads {build}.", { build: state.next });

  return (
    <SettingsRow
      {...searchableSetting("staged-build")}
      description={
        state.previous
          ? gt("Running {running}. {loads} Undo goes back to {previous}.", {
              running: state.running,
              loads,
              previous: state.previous,
            })
          : gt("Running {running}. {loads} No earlier build in {folder}.", {
              running: state.running,
              loads,
              folder: state.folder,
            })
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={
            pending ||
            (environmentId ? !canRun || remote.isPending : query.isPending) ||
            state.previous === null
          }
          onClick={undo}
        >
          <T context="verb, undo a staged build">Undo</T>
        </Button>
      }
    />
  );
}
