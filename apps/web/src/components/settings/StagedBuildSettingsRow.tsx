import type { DesktopStagedBuildsState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

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
      description: error instanceof Error ? error.message : "Something went wrong.",
    }),
  );

/** Undoes the last staged AppImage, so the next start loads the build staged before it. */
export function StagedBuildSettingsRow() {
  const bridge = stagedBuilds();
  const query = useEnvironmentQuery(bridge ? stagedBuildsStateAtom : null);
  const [pending, setPending] = useState(false);
  const state = query.data;
  if (!bridge || !state?.next) return null;

  const redo = (undoneAs: string) => {
    void bridge
      .redo(undoneAs)
      .then(refresh)
      .catch((error: unknown) => failureToast("Could not redo the staged build", error));
  };

  const undo = () => {
    setPending(true);
    void bridge
      .undo()
      .then(({ state: after, undoneAs }) => {
        refresh();
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Undid the staged build",
            description: `The next start loads ${after.next}.`,
            actionProps: { children: "Redo", onClick: () => redo(undoneAs) },
          }),
        );
      })
      .catch((error: unknown) => failureToast("Could not undo the staged build", error))
      .finally(() => setPending(false));
  };

  const loads =
    state.next === state.running
      ? `The next start loads this running build, ${state.next}.`
      : `The next start loads ${state.next}.`;

  return (
    <SettingsRow
      {...searchableSetting("staged-build")}
      description={
        state.previous
          ? `${loads} Undo goes back to ${state.previous}.`
          : `${loads} No earlier build in ${state.folder}.`
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || query.isPending || state.previous === null}
          onClick={undo}
        >
          Undo
        </Button>
      }
    />
  );
}
