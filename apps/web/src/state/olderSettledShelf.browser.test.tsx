import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EMPTY_SHELL_STATE } from "@t3tools/client-runtime/state/shell";
import {
  createThreadFamilyAtoms,
  type OlderSettledScope,
  type OlderSettledShelfEnvironment,
} from "@t3tools/client-runtime/state/threads";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { makeThreadFixture } from "../test-fixtures";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "./olderSettledShelf";
import { olderSettledThreads, threadFamilies } from "./threads";

const environmentId = EnvironmentId.make("env-a");
const first = ProjectId.make("project-a");
const second = ProjectId.make("project-b");

function Shelf(props: {
  readonly scopes: ReadonlyArray<OlderSettledScope>;
  readonly expanded?: boolean;
  readonly keepThread?: ScopedThreadRef | null;
  readonly visibleCount?: number;
}) {
  const shelf = useOlderSettledShelf({
    scopes: props.scopes,
    expanded: props.expanded ?? true,
    visibleCount: props.visibleCount ?? 0,
    keepThread: props.keepThread ?? null,
  });
  useOlderSettledShelfGrowth(shelf, []);
  return (
    <>
      <output>{shelf.pages.get(environmentId) ?? 0}</output>
      <span>{shelf.canLoadMore ? "More pages" : "End of pages"}</span>
      <button type="button" onClick={() => shelf.grow(new Map([[environmentId, 1]]))}>
        Grow
      </button>
    </>
  );
}

describe("useOlderSettledShelf", () => {
  it("keeps requested pages when the scope's projects reorder", async () => {
    await using screen = await render(
      <Shelf scopes={[{ environmentId, projectIds: [first, second] }]} />,
      // A bare hook host; nothing here links or navigates.
      { router: false },
    );
    await userEvent.click(screen.getByRole("button", { name: "Grow" }));
    await expect.element(screen.getByRole("status")).toHaveTextContent("1");

    // Loading a page can reorder the sidebar's projects; the shelf must not drop its pages.
    await screen.rerender(<Shelf scopes={[{ environmentId, projectIds: [second, first] }]} />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("1");
  });

  it("pages through hidden rows until the server cursor ends", async () => {
    const scopes = [{ environmentId, projectIds: [first] }];
    const before = "2026-10-01T00:00:00.000Z";
    const older = { before, beforeMs: Date.parse(before), counts: new Map([[first, 25]]) };
    const hiddenThread = makeThreadFixture({ environmentId, projectId: first }).source;
    const read = { snapshotSequence: 5, threads: [hiddenThread] };
    const states = [
      { reads: [], frontier: { settledAt: before } },
      { reads: [read], frontier: { settledAt: before, threadId: hiddenThread.id } },
      { reads: [read], frontier: null },
    ].map((pages) =>
      Atom.make<ReadonlyMap<EnvironmentId, OlderSettledShelfEnvironment>>(
        new Map([[environmentId, { older, pages: { ...pages, status: "ready" } }]]),
      ),
    );
    using _shelf = vi
      .spyOn(olderSettledThreads, "shelfAtom")
      .mockImplementation(([request]) => states[request?.pages ?? 0]!);

    await using screen = await render(
      <Shelf scopes={scopes} visibleCount={1} />,
      // A bare hook host; it needs no router.
      { router: false },
    );
    await expect.element(screen.getByText("End of pages")).toBeVisible();
    await expect.element(screen.getByRole("status")).toHaveTextContent("2");
  });

  it("keeps only the open settled row after collapsing and releases it when the route changes", async () => {
    const scopes = [{ environmentId, projectIds: [first] }];
    const selectedId = ThreadId.make("open");
    const siblingId = ThreadId.make("other");
    const threads = [selectedId, siblingId].map(
      (id) => makeThreadFixture({ id, environmentId, projectId: first }).source,
    );
    const read = { snapshotSequence: 5, threads };
    const before = "2026-10-01T00:00:00.000Z";
    const older = { before, beforeMs: Date.parse(before), counts: new Map([[first, 2]]) };
    const shelf = (expanded: boolean) =>
      Atom.make<ReadonlyMap<EnvironmentId, OlderSettledShelfEnvironment>>(
        new Map([
          [
            environmentId,
            {
              older,
              pages: {
                reads: expanded ? [read] : [],
                frontier: expanded ? null : { settledAt: before },
                status: "ready",
              },
            },
          ],
        ]),
      );
    const closed = shelf(false);
    const loaded = shelf(true);
    const shell = Atom.make(
      AsyncResult.success({
        ...EMPTY_SHELL_STATE,
        generation: 1,
        snapshot: Option.some({
          schemaVersion: 1,
          snapshotSequence: 4,
          projects: [],
          threads: [],
          archivedThreads: [],
          olderSettled: { before, asOfSequence: 4, counts: [] },
        }),
      }),
    );
    const families = createThreadFamilyAtoms(connectionAtomRuntime, () => shell);
    using _shelf = vi
      .spyOn(olderSettledThreads, "shelfAtom")
      .mockImplementation(([request]) => (request?.pages ? loaded : closed));
    using _pages = vi.spyOn(olderSettledThreads, "pageRowsAtom").mockReturnValue(Atom.make([read]));
    using _mount = vi.spyOn(threadFamilies, "mountRows").mockImplementation(families.mountRows);
    const mergedIds = () =>
      appAtomRegistry.get(families.snapshotAtom(environmentId))?.threads.map(({ id }) => id);

    const keepThread = scopeThreadRef(environmentId, selectedId);
    await using screen = await render(
      <Shelf scopes={scopes} keepThread={keepThread} />,
      // A bare hook host; it needs no router.
      { router: false },
    );
    await userEvent.click(screen.getByRole("button", { name: "Grow" }));
    await expect.element(screen.getByRole("status")).toHaveTextContent("1");
    expect(mergedIds()).toEqual([selectedId, siblingId]);

    await screen.rerender(<Shelf scopes={scopes} keepThread={keepThread} expanded={false} />);
    expect(mergedIds()).toEqual([selectedId]);

    await screen.rerender(<Shelf scopes={scopes} expanded={false} />);
    expect(mergedIds()).toEqual([]);
  });
});
