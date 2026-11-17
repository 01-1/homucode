import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, KeybindingCommand } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import type { AnyRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { createNewThreadHandler } from "../hooks/useHandleNewThread";
import { effectiveShortcutsForCommand } from "../keybindings";
import { newMessageId } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { runRegisteredCommand } from "../shortcuts/dispatcher";
import {
  readProject,
  readProjects,
  readQuietThreadShells,
  readThreadShell,
} from "../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";

/** Mirrors `APP_SCRIPT_TYPE_DEFINITIONS` in contracts, which users see as `t3.d.ts`. */
export interface T3Project {
  readonly id: string;
  readonly environmentId: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface T3Thread {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: string;
}

export interface T3App {
  command(command: string): Promise<void>;
  current(): { readonly project: T3Project | null; readonly thread: T3Thread | null };
  projects(): T3Project[];
  threads(projectId?: string): T3Thread[];
  openThread(threadId: string): Promise<void>;
  newThread(project: string, options?: { prompt?: string; model?: string }): Promise<void>;
  send(threadId: string, text: string): Promise<void>;
  toast(title: string, description?: string): void;
}

const isKeybindingCommand = Schema.is(KeybindingCommand);

const toProject = (project: EnvironmentProject): T3Project => ({
  id: project.id,
  environmentId: project.environmentId,
  title: project.title,
  workspaceRoot: project.workspaceRoot,
});

const toThread = (thread: EnvironmentThreadShell): T3Thread => ({
  id: thread.id,
  environmentId: thread.environmentId,
  projectId: thread.projectId,
  title: thread.title,
  status: thread.runtime?.status ?? "idle",
});

function findThread(threadId: string): EnvironmentThreadShell {
  const thread = readQuietThreadShells().find((candidate) => candidate.id === threadId);
  if (!thread) throw new Error(`No thread with id ${threadId} in this window.`);
  return thread;
}

function findProject(idOrPath: string): EnvironmentProject {
  const path = idOrPath.length > 1 ? idOrPath.replace(/[\\/]+$/, "") : idOrPath;
  const matches = readProjects().filter(
    (project) => project.id === idOrPath || project.workspaceRoot === path,
  );
  const project = matches.find((candidate) => candidate.archivedAt == null) ?? matches[0];
  if (!project) throw new Error(`No project with id or folder ${idOrPath} in this window.`);
  return project;
}

/** For commands components handle in their own key listeners: press the bound key. */
function pressBoundShortcut(command: KeybindingCommand): boolean {
  const shortcut = effectiveShortcutsForCommand(
    appAtomRegistry.get(primaryServerKeybindingsAtom),
    command,
  )[0];
  if (!shortcut) return false;
  const mac = isMacPlatform(navigator.platform);
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      // Matching lowercases the event key, so the stored form matches as it is.
      key: shortcut.key,
      metaKey: shortcut.metaKey || (shortcut.modKey && mac),
      ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !mac),
      shiftKey: shortcut.shiftKey,
      altKey: shortcut.altKey,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

export function createAppScriptApi(router: AnyRouter): T3App {
  const handleNewThread = createNewThreadHandler(router);

  return {
    command: async (command) => {
      if (!isKeybindingCommand(command)) throw new Error(`Unknown command ${command}.`);
      if (runRegisteredCommand(command) || pressBoundShortcut(command)) return;
      throw new Error(`${command} has no handler here and no shortcut to press.`);
    },
    current: () => {
      const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
      if (target?.kind === "server") {
        const thread = readThreadShell(target.threadRef);
        const project = thread
          ? readProject(scopeProjectRef(thread.environmentId, thread.projectId))
          : null;
        return {
          thread: thread ? toThread(thread) : null,
          project: project ? toProject(project) : null,
        };
      }
      const draft = target
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
      const project = draft
        ? readProject(scopeProjectRef(draft.environmentId, draft.projectId))
        : null;
      return { thread: null, project: project ? toProject(project) : null };
    },
    projects: () =>
      readProjects()
        .filter((project) => project.archivedAt == null)
        .map(toProject),
    threads: (projectId) =>
      readQuietThreadShells()
        .filter(
          (thread) =>
            thread.archivedAt === null &&
            (projectId === undefined || thread.projectId === projectId),
        )
        .map(toThread),
    openThread: async (threadId) => {
      const thread = findThread(threadId);
      await router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    newThread: async (projectIdOrPath, options) => {
      const project = findProject(projectIdOrPath);
      const modelSelection =
        options?.model === undefined
          ? null
          : (() => {
              const providers =
                appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId)
                  ?.providers ?? [];
              const provider = providers.find(
                (candidate) =>
                  candidate.enabled &&
                  candidate.models.some((model) => model.slug === options.model),
              );
              if (!provider)
                throw new Error(`No enabled provider offers the model ${options.model}.`);
              return { instanceId: provider.instanceId, model: options.model };
            })();
      const opened = await handleNewThread(
        scopeProjectRef(project.environmentId, project.id),
        options?.prompt === undefined ? undefined : { prompt: options.prompt },
      );
      if (!opened) throw new Error(`Could not open a new thread for ${project.title}.`);
      if (modelSelection) {
        useComposerDraftStore
          .getState()
          .setModelSelection(opened.draftId, modelSelection, { explicit: true });
      }
    },
    send: async (threadId, text) => {
      const thread = findThread(threadId);
      if (!readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) {
        throw new Error("This window may not send messages in that thread's environment.");
      }
      const result = await runAtomCommand(appAtomRegistry, threadEnvironment.startTurn, {
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          dispatchMode: "queue",
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    toast: (title, description) => {
      toastManager.add({
        type: "info",
        title,
        ...(description === undefined ? {} : { description }),
      });
    },
  };
}
