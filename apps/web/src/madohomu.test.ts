import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { MADOHOMU_NEW_THREAD_TITLE } from "@t3tools/client-runtime/madohomu";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import type { Atom } from "effect/reactivity";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { useComposerDraftStore } from "./composerDraftStore";
import { startMadoHomuBranchThread } from "./madohomu";
import { appAtomRegistry } from "./rpc/atomRegistry";
import * as entities from "./state/entities";
import { environmentServerConfigsAtom } from "./state/server";
import { environmentThreadShells } from "./state/threads";
import { makeThreadFixture } from "./test-fixtures";

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
