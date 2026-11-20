import * as Effect from "effect/Effect";
import {
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { MADOHOMU_NEW_THREAD_TITLE } from "@t3tools/client-runtime/madohomu";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { environmentCatalog } from "./connection/catalog";
import { useComposerDraftStore } from "./composerDraftStore";
import {
  madohomuNamedThread,
  readMadoHomuContext,
  saveMadoHomuProject,
  startMadoHomuBranchThread,
} from "./madohomu";
import { appAtomRegistry } from "./rpc/atomRegistry";
import * as entities from "./state/entities";
import * as environments from "./state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "./state/server";
import { environmentThreadShells } from "./state/threads";
import { makeThreadFixture } from "./test-fixtures";

const primary = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const sharedProjectId = ProjectId.make("shared-project-id");

function linkedCatalog(localId: EnvironmentId | null) {
  const ids = localId === remote ? [remote, primary] : [primary, remote];
  return {
    isReady: true,
    entries: new Map<EnvironmentId, ConnectionCatalogEntry>(
      ids.map((environmentId) => {
        const identity = { environmentId, label: environmentId };
        return [
          environmentId,
          {
            enabled: true,
            profile: Option.none(),
            target:
              environmentId === localId
                ? new PrimaryConnectionTarget({
                    ...identity,
                    httpBaseUrl: "http://localhost:3773",
                    wsBaseUrl: "ws://localhost:3773",
                  })
                : new RelayConnectionTarget(identity),
          },
        ];
      }),
    ),
  };
}

it("uses the same saved destination across primaries while a thread URL stays on its own machine", () => {
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    madohomuEnabled: true,
    madohomuProjectId: sharedProjectId,
  };
  const local = { settings: { ...settings, madohomuDestinationEnvironmentId: remote } };
  const configs = new Map([
    [primary, local],
    [remote, { settings: { ...settings, madohomuDestinationEnvironmentId: primary } }],
  ]);
  using _projects = vi
    .spyOn(entities, "readProjects")
    .mockReturnValue(
      [primary, remote].map(
        (environmentId) =>
          ({ id: sharedProjectId, environmentId }) as ReturnType<
            typeof entities.readProjects
          >[number],
      ),
    );
  const registryFor = (localId: EnvironmentId | null, online = true) =>
    AtomRegistry.make({
      initialValues: [
        [environmentCatalog.catalogValueAtom, linkedCatalog(localId), { skipInitialRun: true }],
        [
          environmentServerConfigsAtom,
          online ? configs : new Map([[primary, local]]),
          { skipInitialRun: true },
        ],
      ],
    });
  const online = registryFor(primary);
  const otherPrimary = registryFor(remote);
  const hosted = registryFor(null);
  const offline = registryFor(primary, false);
  onTestFinished(() => {
    online.dispose();
    otherPrimary.dispose();
    hosted.dispose();
    offline.dispose();
  });
  using atoms = vi.spyOn(appAtomRegistry, "get").mockImplementation(online.get.bind(online));
  const router = (search: { environmentId?: EnvironmentId; threadId?: ThreadId }) =>
    ({ state: { location: { pathname: "/madohomu", search } } }) as unknown as AnyRouter;

  expect(readMadoHomuContext(router({}))?.project.environmentId).toBe(remote);
  expect(
    readMadoHomuContext(router({ environmentId: primary, threadId: ThreadId.make("thread") }))
      ?.project.environmentId,
  ).toBe(primary);
  atoms.mockImplementation(otherPrimary.get.bind(otherPrimary));
  expect(readMadoHomuContext(router({}))?.project.environmentId).toBe(remote);
  atoms.mockImplementation(hosted.get.bind(hosted));
  expect(readMadoHomuContext(router({}))?.project.environmentId).toBe(remote);
  atoms.mockImplementation(offline.get.bind(offline));
  expect(readMadoHomuContext(router({}))).toBeNull();
});

it.each([primary, remote, null])(
  "persists the same destination on the shared server with primary %s",
  async (localId) => {
    const registry = AtomRegistry.make({
      initialValues: [
        [environmentCatalog.catalogValueAtom, linkedCatalog(localId), { skipInitialRun: true }],
        [environmentServerConfigsAtom, new Map(), { skipInitialRun: true }],
        [serverEnvironment.updateSettings.permissionAtom(primary), true, { skipInitialRun: true }],
        [serverEnvironment.updateSettings.permissionAtom(remote), true, { skipInitialRun: true }],
      ],
    });
    onTestFinished(() => registry.dispose());
    using _environment = vi.spyOn(environments, "readEnvironment").mockImplementation(
      (id) =>
        ({
          label: id,
          connection: { phase: "connected", error: null, traceId: null },
          serverConfig: { settings: DEFAULT_SERVER_SETTINGS },
        }) as unknown as environments.EnvironmentPresentation,
    );
    using _get = vi.spyOn(appAtomRegistry, "get").mockImplementation(registry.get.bind(registry));
    using _set = vi.spyOn(appAtomRegistry, "set").mockImplementation(registry.set.bind(registry));
    using update = vi
      .spyOn(serverEnvironment.updateSettings, "run")
      .mockImplementation((_registry, { input: { patch } }) =>
        Effect.succeed(
          AsyncResult.success({
            ...DEFAULT_SERVER_SETTINGS,
            madohomuEnabled: patch.madohomuEnabled ?? false,
            madohomuProjectId: patch.madohomuProjectId ?? null,
            madohomuDestinationEnvironmentId: patch.madohomuDestinationEnvironmentId ?? null,
          }),
        ),
      );

    await expect(saveMadoHomuProject(remote, sharedProjectId)).resolves.toBe(true);
    expect(update.mock.calls.map(([, command]) => command)).toEqual([
      {
        environmentId: remote,
        input: { patch: { madohomuEnabled: true, madohomuProjectId: sharedProjectId } },
      },
      {
        environmentId: primary,
        input: { patch: { madohomuDestinationEnvironmentId: remote } },
      },
    ]);
  },
);

it("checks for a newly created thread on the named machine", () => {
  const threadId = ThreadId.make("same-thread-id");
  const created = new Set([threadKey(scopeThreadRef(remote, threadId))]);
  const input = {
    created,
    detail: null,
    detailStatus: "deleted",
    shell: null,
    shellStatus: "live",
  } as const;
  expect(madohomuNamedThread({ ...input, ref: scopeThreadRef(primary, threadId) }).listLoaded).toBe(
    true,
  );
  expect(madohomuNamedThread({ ...input, ref: scopeThreadRef(remote, threadId) }).listLoaded).toBe(
    false,
  );
});

it.each(["blank", "text", "attachment"])(
  "reuses only a blank thread on the branch (%s)",
  async (content) => {
    const environmentId = EnvironmentId.make("madohomu-test");
    const projectId = ProjectId.make("project");
    const checkout = { branch: "feature", worktreePath: "/repo-feature" };
    const first = ThreadId.make("first");
    const second = ThreadId.make("second");
    const ref = scopeThreadRef(environmentId, first);
    const drafts = useComposerDraftStore.getState();
    onTestFinished(() => drafts.clearComposerContent(ref));
    if (content === "text") drafts.setPrompt(ref, "Unsent prompt");
    if (content === "attachment") {
      const file = new File(["notes"], "notes.txt", { type: "text/plain" });
      drafts.addFiles(ref, [
        {
          type: "file",
          id: "notes",
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          file,
        },
      ]);
    }
    const shells = [first, second].map((id) =>
      makeThreadFixture({
        id,
        environmentId,
        projectId,
        title: MADOHOMU_NEW_THREAD_TITLE,
        ...checkout,
      }),
    );
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      madohomuEnabled: true,
      madohomuProjectId: projectId,
      madohomuThreadOrder: [first, second],
      madohomuThreads: { [first]: { pinned: true }, [second]: { pinned: true } },
    };
    using _projects = vi
      .spyOn(entities, "readProjects")
      .mockReturnValue([
        { id: projectId, environmentId } as ReturnType<typeof entities.readProjects>[number],
      ]);
    const get = appAtomRegistry.get.bind(appAtomRegistry);
    using _atoms = vi
      .spyOn(appAtomRegistry, "get")
      .mockImplementation(<A>(atom: Atom.Atom<A>): A => {
        if (atom === environmentServerConfigsAtom)
          return new Map([[environmentId, { settings }]]) as A;
        if (atom === environmentThreadShells.visibleThreadShellsAtom) return shells as A;
        return get(atom);
      });
    const navigate = vi.fn();
    const router = {
      navigate,
      state: { location: { pathname: "/madohomu", search: { environmentId } } },
    } as unknown as AnyRouter;

    await expect(
      startMadoHomuBranchThread(router, { ...ref, projectId, ...checkout }),
    ).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/madohomu",
      search: { environmentId, threadId: content === "blank" ? first : second },
    });
  },
);
