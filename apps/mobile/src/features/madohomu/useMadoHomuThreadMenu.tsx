import type { MenuAction } from "@react-native-menu/menu";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isMadoHomuThreadPinned, MADOHOMU_SCRATCH_LABEL } from "@t3tools/client-runtime/madohomu";
import {
  MADOHOMU_SECTION_NAME_MAX_LENGTH,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";

import type { AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";
import * as Dialog from "../../components/ui/Dialog";
import { useThreadShell } from "../../state/entities";
import { MadoHomuThreadEditor } from "./MadoHomuThreadEditor";
import type { useMadoHomuFiling } from "./useMadoHomuActions";

export function promptSectionName(
  title: string,
  initialValue: string,
  onName: (name: string) => void,
) {
  Dialog.prompt({
    title,
    initialValue,
    confirmText: "Save",
    onConfirm: (value) => {
      const name = value.trim().slice(0, MADOHOMU_SECTION_NAME_MAX_LENGTH);
      if (name) onName(name);
    },
  });
}

/** Where a row sits in Pinned or a custom section, for its Reorder and Move up/down items. */
interface MadoHomuManualPlace {
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

/**
 * MadoHomu's own thread menu items (Move to, Reorder and Move up/down for manual rows, Edit…),
 * shared by the list's long-press menu and the open thread's header menu, plus the editor sheet.
 */
export function useMadoHomuThreadMenu(input: {
  readonly environmentId: EnvironmentId;
  readonly actions: ReturnType<typeof useMadoHomuFiling>;
  readonly canEdit: boolean;
  readonly onReorder?: () => void;
  readonly onStep?: (threadId: ThreadId, direction: "up" | "down") => void;
}) {
  const { environmentId, actions, canEdit } = input;
  const { settings } = actions;
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const edited = useThreadShell(editing === null ? null : scopeThreadRef(environmentId, editing));

  const menu = (threadId: ThreadId, manual: MadoHomuManualPlace | null): MenuAction[] => {
    const entry = settings.madohomuThreads[threadId];
    const pinned = isMadoHomuThreadPinned(entry);
    const filedIn = settings.madohomuSections.some((section) => section.id === entry?.section)
      ? entry?.section
      : null;
    const disabled = { disabled: !canEdit };
    return [
      {
        id: "extra:move",
        title: "Move to",
        image: "folder",
        subactions: [
          {
            id: "extra:section:",
            title: "Pinned",
            state: pinned && filedIn === null ? "on" : "off",
            attributes: disabled,
          },
          ...settings.madohomuSections.map((section): MenuAction => ({
            id: `extra:section:${section.id}`,
            title: section.name,
            state: pinned && filedIn === section.id ? "on" : "off",
            attributes: disabled,
          })),
          {
            id: "extra:scratch",
            title: MADOHOMU_SCRATCH_LABEL,
            state: pinned ? "off" : "on",
            attributes: disabled,
          },
          { id: "extra:new-section", title: "New section…", attributes: disabled },
        ],
      },
      ...(manual && input.onReorder
        ? [
            {
              id: "extra:reorder",
              title: "Reorder…",
              image: "arrow.up.arrow.down",
              attributes: disabled,
            } satisfies MenuAction,
          ]
        : []),
      ...(manual && input.onStep
        ? [
            {
              id: "extra:up",
              title: "Move up",
              image: "arrow.up",
              attributes: { disabled: !canEdit || !manual.canMoveUp },
            } satisfies MenuAction,
            {
              id: "extra:down",
              title: "Move down",
              image: "arrow.down",
              attributes: { disabled: !canEdit || !manual.canMoveDown },
            } satisfies MenuAction,
          ]
        : []),
      { id: "extra:edit", title: "Edit…", image: "slider.horizontal.3", attributes: disabled },
    ];
  };

  const handle = (threadId: ThreadId, event: string) => {
    if (!canEdit) return;
    if (event === "extra:edit") setEditing(threadId);
    else if (event === "extra:reorder") input.onReorder?.();
    else if (event === "extra:scratch") void actions.setThreadPlace(threadId, null);
    else if (event === "extra:new-section") {
      promptSectionName("New section", "", (name) => void actions.moveToNewSection(threadId, name));
    } else if (event.startsWith("extra:section:")) {
      const section = event.slice("extra:section:".length);
      void actions.setThreadPlace(threadId, { section: section || null });
    } else if (event === "extra:up" || event === "extra:down") {
      input.onStep?.(threadId, event === "extra:up" ? "up" : "down");
    }
  };

  const toItem = (threadId: ThreadId, action: MenuAction): AppBarMenuItem => {
    const id = action.id ?? action.title;
    const icon = action.image ? { icon: action.image } : {};
    return action.subactions
      ? {
          id,
          title: action.title,
          ...icon,
          items: action.subactions.map((sub) => toItem(threadId, sub)),
        }
      : {
          id,
          title: action.title,
          ...icon,
          disabled: action.attributes?.disabled === true,
          selected: action.state === "on",
          onPress: () => handle(threadId, id),
        };
  };

  /** The same items as an app bar menu, for the open thread's header. */
  const headerMenu = (threadId: ThreadId): AppBarMenu => ({
    title: "MadoHomu",
    icon: "folder",
    items: menu(threadId, null).map((action) => toItem(threadId, action)),
  });

  const editor =
    settings.madohomuEnabled && edited ? (
      <MadoHomuThreadEditor
        key={edited.id}
        environmentId={environmentId}
        thread={edited}
        onClose={() => setEditing(null)}
      />
    ) : null;

  return { menu, handle, headerMenu, editor };
}
