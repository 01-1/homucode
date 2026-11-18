import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { MADOHOMU_NEW_THREAD_TITLE } from "@t3tools/client-runtime/madohomu";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

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
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { environmentServerConfigsAtom, serverEnvironment } from "./state/server";
import { environmentThreadShells } from "./state/threads";
import { makeThreadFixture } from "./test-fixtures";

const primary = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const sharedProjectId = ProjectId.make("shared-project-id");

it("uses the saved launch destination while a thread URL stays on its own machine", () => {
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    madohomuEnabled: true,
    madohomuProjectId: sharedProjectId,
  };
  const local = { settings: { ...settings, madohomuDestinationEnvironmentId: remote } };
  const configs = new Map([
    [primary, local],
    [remote, { settings }],
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
  const registryFor = (online: boolean) =>
    AtomRegistry.make({
      initialValues: [
        [primaryEnvironmentIdAtom, primary, { skipInitialRun: true }],
        [
          environmentServerConfigsAtom,
          online ? configs : new Map([[primary, local]]),
          { skipInitialRun: true },
        ],
      ],
    });
  const online = registryFor(true);
  const offline = registryFor(false);
  onTestFinished(() => {
    online.dispose();
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
  atoms.mockImplementation(offline.get.bind(offline));
  expect(readMadoHomuContext(router({}))).toBeNull();
});

it.each(["remote", "local", "read-only primary", "older primary"] as const)(
  "saves only to the settings that own the project and destination (%s)",
  async (scenario) => {
    const target = scenario === "local" ? primary : remote;
    using _environments = vi.spyOn(environments, "readEnvironment").mockReturnValue({
      connection: { phase: "connected", error: null, traceId: null },
    } as environments.EnvironmentPresentation);
    const get = appAtomRegistry.get.bind(appAtomRegistry);
    using _atoms = vi
      .spyOn(appAtomRegistry, "get")
      .mockImplementation(<A>(atom: Atom.Atom<A>): A => {
        if (atom === primaryEnvironmentIdAtom) return primary as A;
        if (atom === environmentServerConfigsAtom) return new Map() as A;
        if (atom === serverEnvironment.updateSettings.permissionAtom(primary)) {
          return (scenario !== "read-only primary") as A;
        }
        if (atom === serverEnvironment.updateSettings.permissionAtom(remote)) return true as A;
        return get(atom);
      });
    using update = vi
      .spyOn(serverEnvironment.updateSettings, "run")
      .mockImplementation(async (_registry, { environmentId, input: { patch } }) =>
        AsyncResult.success({
          ...DEFAULT_SERVER_SETTINGS,
          madohomuEnabled: patch.madohomuEnabled ?? false,
          madohomuProjectId: patch.madohomuProjectId ?? null,
          madohomuDestinationEnvironmentId:
            environmentId === primary && scenario === "older primary"
              ? null
              : (patch.madohomuDestinationEnvironmentId ?? null),
        }),
      );
    const selection = saveMadoHomuProject(target, sharedProjectId);
    if (scenario === "read-only primary") {
      await expect(selection).rejects.toThrow("settings access on the primary machine");
      expect(update).not.toHaveBeenCalled();
      return;
    }
    if (scenario === "older primary") {
      await expect(selection).rejects.toThrow("project was saved on its machine");
    } else {
      await expect(selection).resolves.toBe(true);
    }
    const ownerPatch = { madohomuEnabled: true, madohomuProjectId: sharedProjectId };
    expect(update.mock.calls.map(([, command]) => command)).toEqual(
      target === primary
        ? [
            {
              environmentId: primary,
              input: { patch: { ...ownerPatch, madohomuDestinationEnvironmentId: primary } },
            },
          ]
        : [
            { environmentId: remote, input: { patch: ownerPatch } },
            {
              environmentId: primary,
              input: { patch: { madohomuDestinationEnvironmentId: remote } },
            },
          ],
    );
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
