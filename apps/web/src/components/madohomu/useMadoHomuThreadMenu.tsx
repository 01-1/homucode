import {
  isMadoHomuThreadPinned,
  MADOHOMU_SCRATCH_LABEL,
  reorderMadoHomuThreads,
} from "@t3tools/client-runtime/madohomu";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuItem,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";
import { create } from "zustand";
import type { ThreadActionMenuExtras } from "../../hooks/useThreadActionMenu";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentScope } from "../../state/session";
import { MADOHOMU_THREAD_MENU_LABELS } from "../threadActionMenu.logic";
import { useSidebar } from "../ui/sidebar";
import { MadoHomuThreadEditor } from "./MadoHomuThreadEditor";
import { useMadoHomuActions } from "./useMadoHomuActions";
import { useMadoHomuThreads } from "./useMadoHomuThreads";

const MENU_EDIT = "madohomu:edit";
const MENU_MOVE = "madohomu:move";
const MENU_NEW_SECTION = "madohomu:new-section";
const MENU_SCRATCH = "madohomu:scratch";
const MENU_SECTION_PREFIX = "madohomu:section:";

/**
 * The section whose name the sidebar is editing, and the new section being named. A new section
 * ("+" or "New section…" in any menu) stays a draft until its name is committed; only then are
 * it and the threads moving into it saved, so Escape leaves nothing behind.
 */
export const useMadoHomuRenamingSection = create<{
  id: string | null;
  set: (id: string | null) => void;
  draft: { readonly id: string; readonly threadIds: ReadonlyArray<ThreadId> } | null;
  startDraft: (threadIds: ReadonlyArray<ThreadId>) => void;
  clearDraft: () => void;
}>((set) => ({
  id: null,
  set: (id) => set({ id }),
  draft: null,
  startDraft: (threadIds) => set({ draft: { id: randomUUID(), threadIds } }),
  clearDraft: () => set({ draft: null }),
}));

/**
 * MadoHomu's own thread menu items ("Move to" and "Edit…") and the editor they open. The sidebar
 * rows and the open thread's title bar both use it, so the two menus match.
 */
export function useMadoHomuThreadMenu(environmentId: EnvironmentId) {
  const actions = useMadoHomuActions(environmentId);
  const { settings } = actions;
  const { threads, groups } = useMadoHomuThreads(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canEdit = canOperate && actions.canWrite;
  const startDraft = useMadoHomuRenamingSection((s) => s.startDraft);
  const sidebar = useSidebar();
  // The name field lives in the sidebar, so a menu outside it (the title bar) opens it first.
  const startDraftSection = (threadIds: ReadonlyArray<ThreadId>) => {
    if (sidebar.isMobile) sidebar.setOpenMobile(true);
    else sidebar.setOpen(true);
    startDraft(threadIds);
  };
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const manualIds = groups
    .filter((g) => g.kind === "pinned" || g.kind === "custom")
    .flatMap((g) => g.threads.map((t) => t.id));

  // Built on the saved order so snoozed and settled pinned threads keep their places.
  const savedOrder = () => [
    ...manualIds.filter((id) => !settings.madohomuThreadOrder.includes(id)),
    ...settings.madohomuThreadOrder,
  ];
  const fileThread = (threadId: ThreadId, section: string | null, before: ThreadId | null) =>
    actions.save({
      madohomuThreadOrder: reorderMadoHomuThreads(savedOrder(), threadId, before),
      madohomuThreads: {
        [threadId]: actions.threadEntry(threadId, { pinned: true, section }),
      },
    });
  const menuExtras = (threadId: ThreadId): ThreadActionMenuExtras => {
    const entry = settings.madohomuThreads[threadId];
    const pinned = isMadoHomuThreadPinned(entry);
    const section = pinned
      ? (settings.madohomuSections.find((s) => s.id === entry?.section)?.id ?? null)
      : undefined;
    const moveTo: ContextMenuItem = {
      id: MENU_MOVE,
      label: "Move to",
      icon: "folder",
      disabled: !canEdit,
      children: [
        { id: MENU_SECTION_PREFIX, label: "Pinned", checked: section === null },
        ...settings.madohomuSections.map((s) => ({
          id: `${MENU_SECTION_PREFIX}${s.id}`,
          label: s.name,
          checked: section === s.id,
        })),
        { id: MENU_SCRATCH, label: MADOHOMU_SCRATCH_LABEL, checked: !pinned },
        { id: MENU_NEW_SECTION, label: "New section…", separatorBefore: true },
      ],
    };
    return {
      items: [moveTo],
      afterRename: [{ id: MENU_EDIT, label: "Edit…", icon: "pencil", disabled: !canEdit }],
      labels: MADOHOMU_THREAD_MENU_LABELS,
      onSelect: (id) => {
        if (id === MENU_EDIT) setEditing(threadId);
        else if (id === MENU_SCRATCH) {
          if (pinned) void actions.patchThread(threadId, { pinned: false });
        } else if (id === MENU_NEW_SECTION) startDraftSection([threadId]);
        else if (id.startsWith(MENU_SECTION_PREFIX)) {
          const target = id.slice(MENU_SECTION_PREFIX.length) || null;
          if (!pinned || target !== section) void fileThread(threadId, target, null);
        }
      },
    };
  };
  const edited = threads.find((t) => t.id === editing);
  const editor = edited ? (
    <MadoHomuThreadEditor
      key={edited.id}
      environmentId={environmentId}
      thread={edited}
      onClose={() => setEditing(null)}
    />
  ) : null;
  return { menuExtras, fileThread, savedOrder, setEditing, editor, canEdit, startDraftSection };
}
