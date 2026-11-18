import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isListedSettledThread,
  settledShelfFrontier,
  sortOlderSettledScopes,
  unloadedOlderSettledCount,
  wantedOlderSettledPages,
  type OlderSettledPages,
  type OlderSettledScope,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { olderSettledThreads, threadFamilies } from "./threads";

export const SETTLED_TAIL_INITIAL_COUNT = 10;
export const SETTLED_TAIL_PAGE_COUNT = 25;

const NO_PAGES: ReadonlyMap<EnvironmentId, number> = new Map();

function findSettledRow(
  scopeKey: string,
  ref: ScopedThreadRef | null,
  reads: OlderSettledPages["reads"] | undefined,
) {
  if (ref === null || reads === undefined) return null;
  for (const { threads, snapshotSequence } of reads) {
    const thread = threads.find((row) => row.id === ref.threadId);
    if (thread !== undefined) {
      return { scopeKey, environmentId: ref.environmentId, snapshotSequence, thread };
    }
  }
  return null;
}

function useRetainedSettledRow(
  scopeKey: string,
  ref: ScopedThreadRef | null,
  reads: OlderSettledPages["reads"] | undefined,
) {
  const loaded = findSettledRow(scopeKey, ref, reads);
  const [retained, setRetained] = useState(loaded);
  const sameRoute =
    ref !== null &&
    retained?.scopeKey === scopeKey &&
    retained.environmentId === ref.environmentId &&
    retained.thread.id === ref.threadId;
  if (loaded !== null) {
    if (
      !sameRoute ||
      retained.thread !== loaded.thread ||
      retained.snapshotSequence !== loaded.snapshotSequence
    ) {
      setRetained(loaded);
    }
  } else if (retained !== null && !sameRoute) {
    setRetained(null);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the open row in the shell registry when the shelf releases its pages
  useEffect(() => {
    if (retained === null) return;
    const { environmentId, snapshotSequence, thread } = retained;
    return threadFamilies.mountRows(
      appAtomRegistry,
      environmentId,
      `older-settled:open:${thread.id}:${snapshotSequence}`,
      Atom.make([{ snapshotSequence, threads: [thread] }]),
    );
  }, [retained]);
}

/**
 * The Settled shelf for one scope when shells leave older settled threads out: which rows it may
 * list, how many threads it holds in all, and the pages read below each environment's cut, whose
 * rows merge into the thread list. `useOlderSettledShelfGrowth` reads the next pages.
 */
export function useOlderSettledShelf(input: {
  readonly scopes: ReadonlyArray<OlderSettledScope>;
  /** A collapsed shelf mounts no pages, so a reconnect reads none; expanding restores them. */
  readonly expanded: boolean;
  /** Rows the shelf shows; pages are read until it lists that many. */
  readonly visibleCount: number;
  /** Drops the pages read so far when collapsed, so opening again starts from the cut. */
  readonly forgetWhenCollapsed?: boolean;
  /** Retains the open row if releasing the pages would remove it from the shell. */
  readonly keepThread?: ScopedThreadRef | null;
}) {
  const scopes = sortOlderSettledScopes(input.scopes);
  const scopeKey = JSON.stringify(scopes);
  const [requested, setRequested] = useState({ scopeKey, pages: NO_PAGES });
  if (input.forgetWhenCollapsed === true && !input.expanded && requested.pages !== NO_PAGES) {
    setRequested({ scopeKey, pages: NO_PAGES });
  }
  const pages = requested.scopeKey === scopeKey && input.expanded ? requested.pages : NO_PAGES;
  const shelfScopes = scopes.map((scope) => ({
    scope,
    pages: pages.get(scope.environmentId) ?? 0,
  }));
  const shelfKey = JSON.stringify(shelfScopes);
  const shelf = useAtomValue(olderSettledThreads.shelfAtom(shelfScopes));
  useRetainedSettledRow(
    scopeKey,
    input.keepThread ?? null,
    input.keepThread ? shelf.get(input.keepThread.environmentId)?.pages.reads : undefined,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts the requested older settled pages into the thread family registry while shown
  useEffect(() => {
    const releases = (JSON.parse(shelfKey) as typeof shelfScopes).flatMap(({ scope, pages }) =>
      pages === 0
        ? []
        : [
            threadFamilies.mountRows(
              appAtomRegistry,
              scope.environmentId,
              olderSettledThreads.rowsKey(scope, pages),
              olderSettledThreads.pageRowsAtom(scope, pages),
            ),
          ],
    );
    return () => {
      for (const release of releases) release();
    };
  }, [shelfKey]);

  const olderOf = (environmentId: EnvironmentId) => shelf.get(environmentId)?.older ?? null;
  const pagesOf = (environmentId: EnvironmentId) => shelf.get(environmentId)?.pages;
  const environments = [...shelf.values()];
  const frontier = settledShelfFrontier(environments);
  const loaded = shelfScopes.filter(({ pages }) => pages > 0);
  return {
    environments: shelf,
    visibleCount: input.expanded ? input.visibleCount : 0,
    pages,
    grow: (next: ReadonlyMap<EnvironmentId, number>) => setRequested({ scopeKey, pages: next }),
    isListed: (thread: EnvironmentThreadShell) => isListedSettledThread(thread.source, frontier),
    canLoadMore: environments.some(({ older, pages }) => older !== null && pages.frontier !== null),
    /** Older settled threads in scope that are not local; add it to the local Settled rows. */
    unloadedCount: (threads: ReadonlyArray<EnvironmentThreadShell>) =>
      unloadedOlderSettledCount({ olderSettled: olderOf, scopes, threads }),
    loading: loaded.some(({ scope }) => pagesOf(scope.environmentId)?.status === "pending"),
    failed: loaded.some(({ scope }) => pagesOf(scope.environmentId)?.status === "failed"),
    retry: () => {
      for (const { scope, pages } of loaded) {
        olderSettledThreads.retryPages(appAtomRegistry, scope, pages);
      }
    },
  };
}

/** Reads the next pages while the shelf lists fewer rows than it shows. */
export function useOlderSettledShelfGrowth(
  shelf: ReturnType<typeof useOlderSettledShelf>,
  listedSettledThreads: ReadonlyArray<EnvironmentThreadShell>,
) {
  const wanted = wantedOlderSettledPages({
    requested: shelf.pages,
    environments: shelf.environments,
    listedCount: listedSettledThreads.length,
    visibleCount: shelf.visibleCount,
  });
  const { grow, pages } = shelf;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- requests more older settled pages when the listed threads cannot fill the visible count
  useEffect(() => {
    if (wanted !== pages) grow(wanted);
  }, [wanted, pages, grow]);
}

/**
 * Threads of these projects that this client does not hold (older settled threads), for counts
 * shown outside the shelf, such as a removal confirm.
 */
export function readUnloadedThreadCount(
  members: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): number {
  return unloadedOlderSettledCount({
    olderSettled: (environmentId) =>
      appAtomRegistry.get(olderSettledThreads.olderSettledAtom(environmentId)),
    scopes: [...new Set(members.map((member) => member.environmentId))].map((environmentId) => ({
      environmentId,
      projectIds: members.flatMap((member) =>
        member.environmentId === environmentId ? [member.id] : [],
      ),
    })),
    threads: threads.filter((thread) =>
      members.some(
        (member) => member.environmentId === thread.environmentId && member.id === thread.projectId,
      ),
    ),
  });
}
