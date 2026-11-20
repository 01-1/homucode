import { useAtomValue } from "@effect/atom-react";
import {
  createThreadFolderMemberKeysAtom,
  findThreadFolder,
} from "@t3tools/client-runtime/state/thread-folders";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { MenuAction } from "@react-native-menu/menu";
import {
  ThreadFolderId,
  ThreadFolderName,
  type ScopedThreadRef,
  type ThreadFolderMutation,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import * as Dialog from "../components/ui/Dialog";
import { uuidv4 } from "../lib/uuid";
import { appAtomRegistry } from "./atom-registry";
import { environmentServerConfigsAtom, serverEnvironment, threadFoldersAtom } from "./server";
import { environmentSnapshotAtom } from "./shell";
import { threadFamilies } from "./threads";
import { useAtomCommand } from "./use-atom-command";

const missingFolderMembersAtom = createThreadFolderMemberKeysAtom(
  threadFoldersAtom,
  environmentSnapshotAtom,
);

export function useThreadFolders() {
  const memberKeys = useAtomValue(missingFolderMembersAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retains folder members omitted from the environment shell
  useEffect(() => {
    const releases = (JSON.parse(memberKeys) as readonly ScopedThreadRef[]).map((ref) =>
      threadFamilies.mount(appAtomRegistry, ref.environmentId, ref.threadId),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [memberKeys]);
  return useAtomValue(threadFoldersAtom);
}

const writableFolderEnvironmentsAtom = Atom.make(
  (get) =>
    new Set(
      [...get(environmentServerConfigsAtom)].flatMap(([id, config]) =>
        config.environment.capabilities.threadFolders === true &&
        get(serverEnvironment.mutateThreadFolders.permissionAtom(id))
          ? [id]
          : [],
      ),
    ),
);

const isThreadFolderName = Schema.is(ThreadFolderName);
const FOLDER_CREATE = "extra:thread-folder:create";
const FOLDER_REMOVE = "extra:thread-folder:remove";
const FOLDER_MOVE_PREFIX = "extra:thread-folder:move:";

export function useThreadFolderMenu(folders: ReturnType<typeof useThreadFolders>) {
  const writableEnvironments = useAtomValue(writableFolderEnvironmentsAtom);
  const mutate = useAtomCommand(serverEnvironment.mutateThreadFolders, { reportFailure: false });

  const forThread = (thread: EnvironmentThreadShell) => {
    const current = findThreadFolder(folders, thread);
    const filed = current !== null;
    if (!writableEnvironments.has(thread.environmentId)) return { filed, actions: undefined };
    const destinations = folders.filter(
      (folder) => folder.environmentId === thread.environmentId && folder.id !== current?.id,
    );
    const actions: MenuAction[] = [
      {
        id: "extra:thread-folder",
        title: "Move to folder",
        image: "folder",
        subactions: [
          { id: FOLDER_CREATE, title: "New folder…", image: "folder.badge.plus" },
          ...destinations.map((folder) => ({
            id: `${FOLDER_MOVE_PREFIX}${folder.id}`,
            title: folder.name,
          })),
          ...(current ? [{ id: FOLDER_REMOVE, title: "Remove from folder" }] : []),
        ],
      },
    ];
    return { filed, actions };
  };

  const onAction = (thread: EnvironmentThreadShell, action: string) => {
    const commit = (input: ThreadFolderMutation) => {
      void mutate({ environmentId: thread.environmentId, input }).then((result) => {
        if (result._tag !== "Failure") return;
        const error = Cause.squash(result.cause);
        Dialog.alert(
          "Could not update folder",
          error instanceof Error ? error.message : "The folder could not be updated.",
        );
      });
    };

    if (action === FOLDER_CREATE) {
      Dialog.prompt({
        title: "New folder",
        initialValue: "",
        placeholder: "Folder name",
        confirmText: "Create",
        onConfirm: (value) => {
          const name = value.trim();
          if (!isThreadFolderName(name)) {
            Dialog.alert("Invalid folder name", "Use a name between 1 and 80 characters.");
            return;
          }
          commit({
            type: "folder.create",
            folderId: ThreadFolderId.make(`folder:${uuidv4()}`),
            name,
            threadIds: [thread.id],
          });
        },
      });
    } else if (action === FOLDER_REMOVE) {
      commit({ type: "folder.move", folderId: null, threadIds: [thread.id] });
    } else if (action.startsWith(FOLDER_MOVE_PREFIX)) {
      commit({
        type: "folder.move",
        folderId: ThreadFolderId.make(action.slice(FOLDER_MOVE_PREFIX.length)),
        threadIds: [thread.id],
      });
    }
  };

  return { forThread, onAction };
}
