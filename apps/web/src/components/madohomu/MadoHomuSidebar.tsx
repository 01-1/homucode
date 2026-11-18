import { useAtomValue } from "@effect/atom-react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isMadoHomuThreadPinned,
  MADOHOMU_SCRATCH_LABEL,
  MADOHOMU_SCRATCH_PAGE,
  madohomuEmptyPinnedText,
  madohomuIconColor,
  moveMadoHomuThreadsLast,
  pageMadoHomuRows,
  type MadoHomuGroup,
} from "@t3tools/client-runtime/madohomu";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { canSnooze, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import {
  AuthOrchestrationOperateScope,
  MADOHOMU_SECTION_NAME_MAX_LENGTH,
  type EnvironmentId,
  type MadoHomuSection,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  AppWindowIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PlusIcon,
  SettingsIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { useThreadNavigationShortcuts } from "../../hooks/useThreadNavigationShortcuts";
import { useAcknowledgeThreadWoke, useThreadActions } from "../../hooks/useThreadActions";
import { cn, isMacPlatform } from "../../lib/utils";
import {
  buildMultiSelectFolderMenuItems,
  isThreadFolderMenuId,
  runThreadFolderMenuAction,
} from "../../hooks/threadFolderMenu";
import { readLocalApi } from "../../localApi";
import { madohomuNeedsUser as needsUser } from "../../madohomu";
import { useServerConfigs, useThreadShellsForProjectRefs } from "../../state/entities";
import {
  SETTLED_TAIL_INITIAL_COUNT,
  SETTLED_TAIL_PAGE_COUNT,
  useOlderSettledShelf,
  useOlderSettledShelfGrowth,
} from "../../state/olderSettledShelf";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import type { SidebarThreadSummary } from "../../types";
import { canShareWithGuestAtom } from "../chat/guestShareAvailability";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { sidebarProviderEntriesAtom } from "../Sidebar";
import {
  buildBulkTitleRegenerationContextMenuItem,
  isSidebarNestedLinkClick,
  isTrailingDoubleClick,
  resolveSidebarSweepKeys,
  sidebarThreadKeyAtY,
} from "../Sidebar.logic";
import { SidebarPointerSensor } from "../Sidebar.pointer";
import {
  pickSnoozePreset,
  resolveSnoozePresets,
  snoozeWakeLabel,
  type SnoozePreset,
} from "../Sidebar.snooze";
import {
  SortableThreadRow,
  type SidebarProviderEntry,
  type SidebarSweepAction,
} from "../sidebar/SidebarThreadRow";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SidebarContent, SidebarFooter, SidebarHeader, useSidebar } from "../ui/sidebar";
import { MADOHOMU_THREAD_MENU_LABELS } from "../threadActionMenu.logic";
import { titleRegenerationToast } from "../threadTitleRegenerationToast";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MadoHomuIcon } from "./MadoHomuIcon";
import { MadoHomuProjectMenuItems } from "./MadoHomuProjectPicker";
import { useMadoHomuActions } from "./useMadoHomuActions";
import { useMadoHomuEnvironmentId } from "./useMadoHomuEnvironmentId";
import { useMadoHomuRenamingSection, useMadoHomuThreadMenu } from "./useMadoHomuThreadMenu";
import {
  useMadoHomuNewThread,
  useMadoHomuSelectedThreadId,
  useMadoHomuThreads,
} from "./useMadoHomuThreads";

const SNOOZED_EXPANDED_KEY = "t3code:madohomu:snoozed-expanded";
const SETTLED_EXPANDED_KEY = "t3code:madohomu:settled-expanded";
const COLLAPSED_KEY = "t3code:madohomu:collapsed-sections";
const COLLAPSED_SCHEMA = Schema.Record(Schema.String, Schema.Boolean);
const NO_COLLAPSED: { readonly [id: string]: boolean } = {};
const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
// useSensor memoizes on its options, so they live outside render.
const POINTER_SENSOR_OPTIONS = { distance: 6, onAttach: () => {}, onFinish: () => {} };
const SWEEP_DRAG_DISTANCE = 6;
const DND_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];
const OVERLAY_MODIFIERS = [restrictToVerticalAxis];
// Scratch stays newest first, so its rows drag out without making room for each other.
const NO_SORTING = () => null;
const SECTION_DROP_PREFIX = "madohomu-section:";
const MENU_UP = "madohomu:up";
const MENU_DOWN = "madohomu:down";
const readOpensPullRequestsInRightPanel = () => false;

type Group = MadoHomuGroup<SidebarThreadSummary>;
const isManual = (group: Group) => group.kind === "pinned" || group.kind === "custom";
/** The custom section a manual group files threads under; null is Pinned. */
const groupSection = (group: Group) => (group.kind === "custom" ? group.id : null);
const threadKey = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

function failureToast(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function MadoHomuSidebar() {
  const environmentId = useMadoHomuEnvironmentId();
  return environmentId ? (
    <MadoHomuThreadList key={environmentId} environmentId={environmentId} />
  ) : null;
}

function MadoHomuThreadList({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const { threads, groups, now, settings, project } = useMadoHomuThreads(environmentId);
  const selectedId = useMadoHomuSelectedThreadId(environmentId);
  const threadMenu = useMadoHomuThreadMenu(environmentId);
  const { canEdit, fileThread } = threadMenu;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeSheet = () => {
    if (isMobile) setOpenMobile(false);
  };
  const newThread = useMadoHomuNewThread(environmentId, closeSheet);
  const manualGroups = groups.filter(isManual);
  const manualIds = manualGroups.flatMap((g) => g.threads.map((t) => t.id));
  const groupOf = (id: string) => groups.find((g) => g.threads.some((t) => t.id === id));

  const [snoozedExpanded, setSnoozedExpanded] = useLocalStorage(
    SNOOZED_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [settledExpanded, setSettledExpanded] = useLocalStorage(
    SETTLED_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const settledScopeKey = JSON.stringify([environmentId, project?.id]);
  const [settledTail, setSettledTail] = useState({
    scopeKey: settledScopeKey,
    count: SETTLED_TAIL_INITIAL_COUNT,
  });
  if (settledTail.scopeKey !== settledScopeKey) {
    setSettledTail({ scopeKey: settledScopeKey, count: SETTLED_TAIL_INITIAL_COUNT });
  }
  const settledVisibleCount =
    settledTail.scopeKey === settledScopeKey ? settledTail.count : SETTLED_TAIL_INITIAL_COUNT;
  const projectShells = useThreadShellsForProjectRefs(
    project ? [scopeProjectRef(environmentId, project.id)] : [],
  );
  const hidingTags = useAtomValue(serverEnvironment.hiddenThreadTagsAtom(environmentId)) !== null;
  const connected = useEnvironment(environmentId)?.connection.phase === "connected";
  const olderSettled = useOlderSettledShelf({
    scopes: project ? [{ environmentId, projectIds: [project.id] }] : [],
    expanded: settings.madohomuEnabled && settledExpanded,
    visibleCount: connected ? settledVisibleCount : 0,
    keepThread: selectedId === null ? null : scopeThreadRef(environmentId, selectedId),
  });
  const settledThreads = groups.find((g) => g.kind === "settled")?.threads ?? [];
  const listedSettledThreads = connected
    ? settledThreads.filter(olderSettled.isListed)
    : settledThreads;
  useOlderSettledShelfGrowth(olderSettled, listedSettledThreads);
  const missingSettled = olderSettled.unloadedCount(projectShells);
  const historyUnavailable =
    missingSettled > 0 &&
    (!connected ||
      (!olderSettled.canLoadMore &&
        olderSettled.environments.get(environmentId)?.pages.reads.length === 0));
  const unloadedSettledCount = olderSettled.canLoadMore || historyUnavailable ? missingSettled : 0;
  const settledCount = settledThreads.length + unloadedSettledCount;
  const unknownSettledMatches = hidingTags && unloadedSettledCount > 0;
  const settledHeadingCount = unknownSettledMatches ? `${settledThreads.length}+` : settledCount;
  const loadingSettled = connected && olderSettled.loading;
  const failedSettled = connected && olderSettled.failed;
  const settledPaging = loadingSettled || failedSettled;
  const [collapsed, setCollapsed] = useLocalStorage(COLLAPSED_KEY, NO_COLLAPSED, COLLAPSED_SCHEMA);
  const isExpanded = (group: Group) =>
    group.kind === "snoozed"
      ? snoozedExpanded
      : group.kind === "settled"
        ? settledExpanded
        : collapsed[group.id] !== true;
  const toggleExpanded = (group: Group) => {
    if (group.kind === "snoozed") setSnoozedExpanded(!snoozedExpanded);
    else if (group.kind === "settled") setSettledExpanded(!settledExpanded);
    else setCollapsed((current) => ({ ...current, [group.id]: current[group.id] !== true }));
  };
  const [scratchCount, setScratchCount] = useState(MADOHOMU_SCRATCH_PAGE);
  const [renaming, setRenaming] = useState<{
    id: ThreadId;
    title: string;
    originalTitle: string;
  } | null>(null);
  const renamingSection = useMadoHomuRenamingSection((s) => s.id);
  const setRenamingSection = useMadoHomuRenamingSection((s) => s.set);
  const draftSection = useMadoHomuRenamingSection((s) => s.draft);
  const clearDraftSection = useMadoHomuRenamingSection((s) => s.clearDraft);
  const [dragging, setDragging] = useState<ThreadId | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const serverConfigs = useServerConfigs();
  const configLoaded = serverConfigs.has(environmentId);
  const providerEntries =
    useAtomValue(sidebarProviderEntriesAtom).get(environmentId) ?? EMPTY_PROVIDER_ENTRIES;
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const canShareWithGuest = useAtomValue(canShareWithGuestAtom(environmentId));
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    confirmAndUnpinThread,
    markThreadUnread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const regenerateThreadTitle = useOrchestrationCommand(threadEnvironment.regenerateTitle, {
    reportFailure: false,
  });
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);

  const shownThreads = (group: Group) => {
    if (!isExpanded(group)) return group.threads.filter((t) => t.id === selectedId);
    if (group.kind === "settled") {
      const page = listedSettledThreads.slice(0, settledVisibleCount);
      const selected = group.threads.find((thread) => thread.id === selectedId);
      if (selected && !page.includes(selected)) page.push(selected);
      return page;
    }
    if (group.kind !== "scratch") return group.threads;
    const page = pageMadoHomuRows(
      group.threads,
      scratchCount,
      (t) => t.id === selectedId || needsUser(t),
    );
    return page.shown;
  };
  const orderedKeys = groups.flatMap((g) => shownThreads(g).map(threadKey));
  // Every row in the order the sidebar renders them, folded or paged ones included.
  const renderedIds = groups.flatMap((g) => g.threads.map((t) => t.id));
  /**
   * Saves `ids` into `section` (null is Pinned) at its end, in the order their rows show, with
   * `sections` when the move also adds one.
   */
  const moveThreads = (
    ids: ReadonlyArray<ThreadId>,
    section: string | null,
    sections?: ReadonlyArray<MadoHomuSection>,
  ) =>
    actions.save({
      ...(sections ? { madohomuSections: [...sections] } : {}),
      madohomuThreadOrder: moveMadoHomuThreadsLast(threadMenu.savedOrder(), renderedIds, ids),
      madohomuThreads: Object.fromEntries(
        ids.map((id) => [id, actions.threadEntry(id, { pinned: true, section })]),
      ),
    });

  const open = (threadId: ThreadId) => {
    closeSheet();
    void navigate({ to: "/madohomu", search: { environmentId, threadId } });
  };
  const selectedRef = selectedId ? scopeThreadRef(environmentId, selectedId) : null;
  const jumpLabels = useThreadNavigationShortcuts({
    orderedThreadKeys: orderedKeys,
    // A selected thread with no visible row traverses like no selection.
    currentThreadKey:
      selectedRef && orderedKeys.includes(scopedThreadKey(selectedRef))
        ? scopedThreadKey(selectedRef)
        : null,
    routeThreadRef: selectedRef,
    onNavigate: (key) => {
      const ref = parseScopedThreadKey(key);
      if (!ref || !threads.some((t) => t.id === ref.threadId)) return false;
      clearSelection();
      setSelectionAnchor(key);
      open(ref.threadId);
      return true;
    },
  });
  const startRename = useStableCallback((threadRef: ScopedThreadRef, rowTitle?: string) => {
    const title = rowTitle ?? threads.find((t) => t.id === threadRef.threadId)?.title;
    if (canOperate && title !== undefined) {
      setRenaming({ id: threadRef.threadId, title, originalTitle: title });
    }
  });
  const { openMenu } = useThreadActionMenu({
    threadRef: null,
    projectCwd: project?.workspaceRoot ?? null,
    onStartRename: startRename,
    canShareWithGuest,
  });

  const handleThreadClick = useStableCallback((event: MouseEvent, threadRef: ScopedThreadRef) => {
    if (isSidebarNestedLinkClick(event.target)) return;
    const key = scopedThreadKey(threadRef);
    const isModClick = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(key);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectTo(key, orderedKeys);
      return;
    }
    if (isTrailingDoubleClick(event.detail)) return;
    clearSelection();
    setSelectionAnchor(key);
    open(threadRef.threadId);
  });
  const handleActivate = useStableCallback((threadRef: ScopedThreadRef) =>
    open(threadRef.threadId),
  );
  const handleRenameTitleChange = useStableCallback((title: string) =>
    setRenaming((current) => (current ? { ...current, title } : current)),
  );
  const handleCancelRename = useStableCallback(() => setRenaming(null));
  const handleCommitRename = useStableCallback((threadRef: ScopedThreadRef, title: string) => {
    const original = renaming?.originalTitle;
    setRenaming(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (trimmed === original) return;
    void updateThreadMetadata({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, title: trimmed },
    }).then((result) => failureToast("Failed to rename thread", result));
  });
  const handleSettle = useStableCallback((threadRef: ScopedThreadRef) => {
    void settleThread(threadRef).then((r) => failureToast("Failed to settle thread", r));
  });
  const handleUnsettle = useStableCallback((threadRef: ScopedThreadRef) => {
    void unsettleThread(threadRef).then((r) => failureToast("Failed to un-settle thread", r));
  });
  const handleSnooze = useStableCallback(
    (threadRef: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => {
      void snoozeThread(threadRef, preset.snoozedUntil).then((r) =>
        failureToast("Failed to snooze thread", r),
      );
    },
  );
  const handleUnsnooze = useStableCallback((threadRef: ScopedThreadRef) => {
    void unsnoozeThread(threadRef).then((r) => failureToast("Failed to wake thread", r));
  });
  const handleUnpin = useStableCallback((threadRef: ScopedThreadRef) => {
    void confirmAndUnpinThread(threadRef).then((r) => failureToast("Failed to unpin thread", r));
  });

  /** The group menu for a multi-selection, as in T3 Code's list, with MadoHomu's Move to. */
  const openSelectionMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const keys = useThreadSelectionStore.getState().selectedThreadKeys;
    const selected = threads.filter((t) => keys.has(threadKey(t)));
    if (selected.length === 0) return;
    const count = selected.length;
    const refs = selected.map((t) => scopeThreadRef(t.environmentId, t.id));
    const settling = selected.filter((t) => t.settledOverride !== "settled");
    const snoozeNow = new Date();
    const canSnoozeAll =
      configLoaded && selected.every((t) => canSnooze(t, { now: snoozeNow.toISOString() }));
    const presets = resolveSnoozePresets(snoozeNow, timestampFormat, environmentId);
    const pinned = selected.filter((t) => isMadoHomuThreadPinned(settings.madohomuThreads[t.id]));
    const canRun = configLoaded && canOperate;
    const regeneratable = canRun ? selected.filter((t) => t.titleRegeneration == null) : [];
    const titleItem = buildBulkTitleRegenerationContextMenuItem({
      supportedCount: canRun ? count : 0,
      actionableCount: regeneratable.length,
    });
    const selectedIds = selected.map((t) => t.id);
    const codePinned = configLoaded ? selected.filter((t) => t.pinnedAt != null) : [];
    // The place all the selected threads share, if they share one: a section id, null for
    // Pinned, or "scratch".
    const placeOf = (t: SidebarThreadSummary) => {
      const entry = settings.madohomuThreads[t.id];
      if (!isMadoHomuThreadPinned(entry)) return "scratch";
      return settings.madohomuSections.find((s) => s.id === entry?.section)?.id ?? null;
    };
    const firstPlace = placeOf(selected[0]!);
    const sharedPlace = selected.every((t) => placeOf(t) === firstPlace) ? firstPlace : undefined;
    const folderItems = buildMultiSelectFolderMenuItems({
      environmentId,
      threadIds: selectedIds,
      canOperate: canRun,
    }).map((item) =>
      item.id === "folder"
        ? { ...item, label: MADOHOMU_THREAD_MENU_LABELS.folder }
        : item.id === "folder:new-from-selection"
          ? { ...item, label: `New T3 Code folder from selection (${count})` }
          : item,
    );
    const clicked = await settlePromise(() =>
      api.contextMenu.show(
        [
          ...(codePinned.length > 0
            ? [
                {
                  id: "unpin",
                  label: `${MADOHOMU_THREAD_MENU_LABELS.unpin} (${codePinned.length})`,
                  disabled: !canOperate,
                },
              ]
            : []),
          {
            id: "settle",
            label: `Settle (${count})`,
            disabled: !configLoaded || settling.length === 0,
          },
          ...(canSnoozeAll
            ? [
                {
                  id: "snooze",
                  label: `Snooze (${count})`,
                  children: [
                    { id: "snooze:custom", label: "Custom…" },
                    ...presets.map((preset, index) => ({
                      id: `snooze:${preset.id}`,
                      label: preset.label,
                      detail: preset.whenLabel,
                      separatorBefore: index === 0,
                    })),
                  ],
                },
              ]
            : []),
          {
            id: "move",
            label: "Move to",
            icon: "folder" as const,
            disabled: !canEdit,
            children: [
              { id: "move:", label: "Pinned", checked: sharedPlace === null },
              ...settings.madohomuSections.map((s) => ({
                id: `move:${s.id}`,
                label: s.name,
                checked: sharedPlace === s.id,
              })),
              {
                id: "move-scratch",
                label: MADOHOMU_SCRATCH_LABEL,
                checked: sharedPlace === "scratch",
                disabled: pinned.length === 0,
              },
              { id: "move-new-section", label: "New section…", separatorBefore: true },
            ],
          },
          ...(titleItem ? [titleItem] : []),
          ...folderItems,
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true, separatorBefore: true },
        ],
        position,
      ),
    );
    if (clicked._tag === "Failure" || clicked.value === null) return;
    const choice = clicked.value;
    // Already all there: nothing to do, as in the single-thread menu.
    if (choice.startsWith("move:") && (choice.slice("move:".length) || null) === sharedPlace) {
      return;
    }
    clearSelection();
    if (isThreadFolderMenuId(choice)) {
      if (canRun) runThreadFolderMenuAction(choice, { environmentId, threadIds: selectedIds });
    } else if (choice === "regenerate-title") {
      const toast = titleRegenerationToast(
        await Promise.all(
          regeneratable.map((t) =>
            regenerateThreadTitle({ environmentId, input: { threadId: t.id } }),
          ),
        ),
      );
      if (toast) toastManager.add(toast);
    } else if (choice === "settle") {
      for (const t of settling) handleSettle(scopeThreadRef(t.environmentId, t.id));
    } else if (choice.startsWith("snooze:")) {
      const preset =
        choice === "snooze:custom"
          ? await requestCustomSnooze()
          : pickSnoozePreset(
              presets,
              choice.slice("snooze:".length),
              timestampFormat,
              environmentId,
            );
      if (preset) for (const ref of refs) handleSnooze(ref, preset);
    } else if (choice === "move-scratch") {
      void actions.save({
        madohomuThreads: Object.fromEntries(
          pinned.map((t) => [t.id, actions.threadEntry(t.id, { pinned: false })]),
        ),
      });
    } else if (choice === "unpin") {
      if (!canOperate) return;
      for (const t of codePinned) handleUnpin(scopeThreadRef(t.environmentId, t.id));
    } else if (choice === "move-new-section") {
      threadMenu.startDraftSection(selectedIds);
    } else if (choice.startsWith("move:")) {
      void moveThreads(selectedIds, choice.slice("move:".length) || null);
    } else if (choice === "mark-unread") {
      for (const ref of refs) markThreadUnread(ref);
    } else if (choice === "delete") {
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            `Delete ${count} thread${count === 1 ? "" : "s"}?\nThis permanently clears their conversation history.`,
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag !== "Success" || !confirmed.value) return;
      }
      const deletedThreadKeys = new Set(selected.map(threadKey));
      for (const ref of refs) {
        void deleteThread(ref, { deletedThreadKeys }).then((r) =>
          failureToast("Failed to delete thread", r),
        );
      }
    }
  };

  // A pinned row's menu also has Move up and Move down, so reordering works without a mouse.
  const handleContextMenu = useStableCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const selection = useThreadSelectionStore.getState();
      if (
        selection.hasSelection() &&
        selection.selectedThreadKeys.has(scopedThreadKey(threadRef))
      ) {
        void openSelectionMenu(position);
        return;
      }
      const group = groupOf(threadRef.threadId);
      const extras = threadMenu.menuExtras(threadRef.threadId);
      if (!group || !isManual(group)) {
        openMenu(position, { threadRef, extras, isSettled: group?.kind === "settled" });
        return;
      }
      const index = group.threads.findIndex((t) => t.id === threadRef.threadId);
      openMenu(position, {
        threadRef,
        isSettled: false,
        extras: {
          ...extras,
          items: [
            ...extras.items,
            {
              id: MENU_UP,
              label: "Move up",
              icon: "arrow-up",
              separatorBefore: true,
              disabled: !canEdit || index <= 0,
            },
            {
              id: MENU_DOWN,
              label: "Move down",
              icon: "arrow-down",
              disabled: !canEdit || index >= group.threads.length - 1,
            },
          ],
          onSelect: (id) => {
            const section = groupSection(group);
            if (id === MENU_UP) {
              void fileThread(threadRef.threadId, section, group.threads[index - 1]!.id);
            } else if (id === MENU_DOWN) {
              // Order is shared by all sections, so the end of this one is the end of the order.
              void fileThread(threadRef.threadId, section, group.threads[index + 2]?.id ?? null);
            } else extras.onSelect(id);
          },
        },
      });
    },
  );

  // Press on a row's settle (or wake, un-settle) button and sweep over neighbours to act on all.
  const listRef = useRef<HTMLElement>(null);
  const sweepSensorRef = useRef<SidebarPointerSensor | null>(null);
  const [sweep, setSweep] = useState<{
    action: SidebarSweepAction;
    keys: ReadonlySet<string>;
  } | null>(null);
  const startActionSweep = useStableCallback(
    (threadRef: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
      const originKey = scopedThreadKey(threadRef);
      const groupByKey = new Map(
        groups.flatMap((g) => g.threads.map((t) => [threadKey(t), g.id] as const)),
      );
      const keysInOrder = orderedKeys;
      const canApply = (key: string) =>
        configLoaded && groupByKey.has(key) && groupByKey.get(key) === groupByKey.get(originKey);
      let targetKey: string | null = null;
      let sweptKeys: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(keysInOrder, originKey, key, canApply);
        setSweep({ action, keys: new Set(sweptKeys) });
      };
      sweepSensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: SWEEP_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            sweepSensorRef.current = null;
            setSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) => sweepTo(listRef.current && sidebarThreadKeyAtY(listRef.current, y)),
        onEnd: () => {
          for (const key of sweptKeys.filter(canApply)) {
            const ref = parseScopedThreadKey(key);
            if (ref === null) continue;
            if (action === "settle") handleSettle(ref);
            else if (action === "unsettle") handleUnsettle(ref);
            else handleUnsnooze(ref);
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
  );

  const saveSections = (sections: ReadonlyArray<MadoHomuSection>) =>
    actions.save({ madohomuSections: [...sections] });
  // A new section stays a draft until its name is committed (see useMadoHomuRenamingSection).
  const addSection = () => {
    if (draftSection === null) threadMenu.startDraftSection([]);
  };
  const commitDraftSection = (name: string) => {
    const draft = draftSection;
    clearDraftSection();
    const trimmed = name.trim().slice(0, MADOHOMU_SECTION_NAME_MAX_LENGTH);
    if (!trimmed || !draft) return;
    const sections = [...settings.madohomuSections, { id: draft.id, name: trimmed }];
    if (draft.threadIds.length === 0) void saveSections(sections);
    else void moveThreads(draft.threadIds, draft.id, sections);
  };
  const renameSection = (id: string, name: string) => {
    setRenamingSection(null);
    const trimmed = name.trim().slice(0, MADOHOMU_SECTION_NAME_MAX_LENGTH);
    if (!trimmed) return;
    void saveSections(
      settings.madohomuSections.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
    );
  };
  const moveSection = (id: string, offset: -1 | 1) => {
    const sections = [...settings.madohomuSections];
    const index = sections.findIndex((s) => s.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target]!, sections[index]!];
    void saveSections(sections);
  };
  // Stable so a delete confirmed later builds its patch from the settings current then.
  const deleteSection = useStableCallback((id: string) =>
    actions.save({
      madohomuSections: settings.madohomuSections.filter((s) => s.id !== id),
      madohomuThreads: Object.fromEntries(
        Object.entries(settings.madohomuThreads)
          .filter(([, entry]) => entry.section === id)
          .map(([threadId, entry]) => [threadId, { ...entry, section: null }]),
      ),
    }),
  );
  const openSectionMenu = async (section: MadoHomuSection, position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const index = settings.madohomuSections.findIndex((s) => s.id === section.id);
    const clicked = await settlePromise(() =>
      api.contextMenu.show(
        [
          { id: "rename", label: "Rename section", icon: "pencil", disabled: !canEdit },
          { id: "up", label: "Move up", icon: "arrow-up", disabled: !canEdit || index <= 0 },
          {
            id: "down",
            label: "Move down",
            icon: "arrow-down",
            disabled: !canEdit || index >= settings.madohomuSections.length - 1,
          },
          {
            id: "delete",
            label: "Delete section",
            icon: "trash",
            destructive: true,
            separatorBefore: true,
            disabled: !canEdit,
          },
        ],
        position,
      ),
    );
    if (clicked._tag === "Failure" || clicked.value === null) return;
    if (clicked.value === "rename") setRenamingSection(section.id);
    else if (clicked.value === "up" || clicked.value === "down")
      moveSection(section.id, clicked.value === "up" ? -1 : 1);
    else if (clicked.value === "delete") {
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(`Delete section "${section.name}"? Its threads move back to Pinned.`, {
          variant: "destructive",
        }),
      );
      if (confirmed._tag === "Success" && confirmed.value) void deleteSection(section.id);
    }
  };

  const sensors = useSensors(useSensor(SidebarPointerSensor, POINTER_SENSOR_OPTIONS));
  const handleDragStart = ({ active }: DragStartEvent) =>
    setDragging(String(active.id) as ThreadId);
  const dropGroupOf = (overId: string) =>
    overId.startsWith(SECTION_DROP_PREFIX)
      ? groups.find((g) => g.id === overId.slice(SECTION_DROP_PREFIX.length))
      : groupOf(overId);
  const handleDragOver = ({ over }: DragOverEvent) => setDragOverId(over ? String(over.id) : null);
  const endDrag = () => {
    setDragging(null);
    setDragOverId(null);
  };
  const manualDrop = (moved: ThreadId, overId: string) => {
    if (moved === overId) return null;
    const onSection = overId.startsWith(SECTION_DROP_PREFIX);
    const target = dropGroupOf(overId);
    const source = groupOf(moved);
    if (!target || !source || !isManual(target)) return null;
    if (onSection) {
      return source.id === target.id ? null : { target, before: null };
    }
    const from = manualIds.indexOf(moved);
    const to = manualIds.indexOf(overId as ThreadId);
    // Like arrayMove: dragging down lands after the row it is over, dragging up before it.
    const overIndex = target.threads.findIndex((t) => t.id === overId);
    const before =
      from >= 0 && from < to ? (target.threads[overIndex + 1]?.id ?? null) : (overId as ThreadId);
    return { target, before };
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    if (!over || active.id === over.id || !canEdit) return;
    const moved = String(active.id) as ThreadId;
    const overId = String(over.id);
    const drop = manualDrop(moved, overId);
    if (drop) {
      void fileThread(moved, groupSection(drop.target), drop.before);
    } else if (dropGroupOf(overId)?.kind === "scratch") {
      const source = groupOf(moved);
      if (source && isManual(source)) void actions.patchThread(moved, { pinned: false });
    }
  };
  const draggingGroup = dragging === null ? undefined : groupOf(dragging);
  const draggingPinned = draggingGroup !== undefined && isManual(draggingGroup);
  const dragOverGroup = dragOverId === null ? undefined : dropGroupOf(dragOverId);
  const insertion =
    dragging !== null && !draggingPinned && dragOverId !== null
      ? manualDrop(dragging, dragOverId)
      : null;
  // The section a drop would change: another manual section, or Scratch for a pinned row.
  const isDropTarget = (group: Group) =>
    draggingGroup !== undefined &&
    dragOverGroup?.id === group.id &&
    group.id !== draggingGroup.id &&
    (isManual(group) || (group.kind === "scratch" && draggingPinned));
  const draggingThread = dragging === null ? undefined : threads.find((t) => t.id === dragging);

  const row = (group: Group, thread: SidebarThreadSummary) => {
    const isActive = selectedId === thread.id;
    const entry = settings.madohomuThreads[thread.id];
    const key = threadKey(thread);
    return (
      <SortableThreadRow
        key={thread.id}
        sortableId={thread.id}
        sortableDisabled={group.kind === "snoozed" || group.kind === "settled" || !canEdit}
        contextDrag={false}
        thread={thread}
        variant="folder"
        leadingIcon={
          <MadoHomuIcon
            icon={entry?.icon ?? null}
            color={madohomuIconColor(thread.id, entry?.color)}
          />
        }
        variantAction={
          group.kind === "settled" ? "unsettle" : group.kind === "snoozed" ? "unsnooze" : "settle"
        }
        settlementSupported={configLoaded}
        snoozeSupported={configLoaded}
        pinningSupported={configLoaded}
        // The T3 Code pin is in the menu; a row glyph would read as MadoHomu's own pin.
        isPinned={false}
        dropVerb={null}
        dragOverPinned={false}
        insertionBefore={insertion?.target.id === group.id && insertion.before === thread.id}
        folderTintClassName={dragging === thread.id ? "opacity-40" : undefined}
        neverRecede={isManual(group)}
        sweepAction={sweep?.keys.has(key) ? sweep.action : null}
        snoozeWakeLabelText={
          group.kind === "snoozed" && thread.snoozedUntil != null
            ? snoozeWakeLabel(thread.snoozedUntil, { now })
            : null
        }
        wokeAt={threadWokeAt(thread, { now })}
        isActive={isActive}
        isRouteThread={isActive}
        readOpensPullRequestsInRightPanel={readOpensPullRequestsInRightPanel}
        jumpLabel={jumpLabels.get(key) ?? null}
        currentEnvironmentId={environmentId}
        environmentLabel={null}
        environmentMachine="server"
        scratchMachineLabel={null}
        project={project}
        projectDisplayName={null}
        providerEntryByInstanceId={providerEntries}
        timestampFormat={timestampFormat}
        onThreadClick={handleThreadClick}
        onThreadActivate={handleActivate}
        onStartRename={startRename}
        onRenameTitleChange={handleRenameTitleChange}
        onCommitRename={handleCommitRename}
        onCancelRename={handleCancelRename}
        isRenaming={renaming?.id === thread.id}
        renamingTitle={renaming?.id === thread.id ? renaming.title : ""}
        onContextMenu={handleContextMenu}
        showActionsButton
        onSettle={handleSettle}
        onActionSweepStart={startActionSweep}
        onUnsettle={handleUnsettle}
        onSnooze={handleSnooze}
        onUnsnooze={handleUnsnooze}
        onUnpin={handleUnpin}
        onAcknowledgeWoke={acknowledgeWoke}
      />
    );
  };

  const section = (group: Group, header: ReactNode, empty: string | null = null) => {
    const shown = shownThreads(group);
    const moreScratch = group.kind === "scratch" ? group.threads.length - shown.length : 0;
    const moreSettled = group.kind === "settled" ? settledCount - shown.length : 0;
    return (
      <SectionBlock
        key={group.id}
        group={group}
        droppable={group.kind !== "snoozed" && group.kind !== "settled"}
        highlighted={isDropTarget(group)}
        insertionAtEnd={insertion?.target.id === group.id && insertion.before === null}
        header={header}
        empty={isExpanded(group) && group.threads.length === 0 ? empty : null}
      >
        {shown.map((thread) => row(group, thread))}
        {isExpanded(group) && moreScratch > 0 ? (
          <li className="list-none">
            <button
              type="button"
              className={QUIET_BUTTON_CLASS}
              onClick={() => setScratchCount((n) => n + MADOHOMU_SCRATCH_PAGE)}
            >
              Show more ({moreScratch})
            </button>
          </li>
        ) : null}
        {group.kind === "settled" &&
        isExpanded(group) &&
        ((historyUnavailable ? listedSettledThreads.length > shown.length : moreSettled > 0) ||
          settledPaging) ? (
          <li className="list-none">
            <button
              type="button"
              aria-disabled={loadingSettled}
              className={cn(QUIET_BUTTON_CLASS, "aria-disabled:cursor-default")}
              onClick={() => {
                if (loadingSettled) return;
                if (failedSettled) olderSettled.retry();
                else
                  setSettledTail((current) => ({
                    ...current,
                    count: current.count + SETTLED_TAIL_PAGE_COUNT,
                  }));
              }}
            >
              <ChevronDownIcon aria-hidden className="size-3.5" />
              {loadingSettled
                ? "Loading"
                : failedSettled
                  ? "Could not load older threads. Retry"
                  : unknownSettledMatches
                    ? "Show more"
                    : `Show ${Math.min(historyUnavailable ? listedSettledThreads.length - shown.length : moreSettled, SETTLED_TAIL_PAGE_COUNT)} more`}
            </button>
          </li>
        ) : null}
        {group.kind === "settled" && isExpanded(group) && historyUnavailable ? (
          <li className="list-none px-2 text-xs text-muted-foreground">
            Reconnect to load older threads.
          </li>
        ) : null}
      </SectionBlock>
    );
  };
  const attention = (group: Group) =>
    isExpanded(group) ? 0 : group.threads.filter(needsUser).length;
  const heading = (group: Group, buttons: ReactNode = null) => (
    <SectionHeading
      id={`madohomu-section-${group.id}`}
      title={group.title}
      count={group.kind === "settled" ? settledHeadingCount : group.threads.length}
      attention={attention(group)}
      expanded={isExpanded(group)}
      onToggle={() => toggleExpanded(group)}
      actions={buttons}
    />
  );

  const enabled = settings.madohomuEnabled;
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">MadoHomu</span>
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label="MadoHomu menu"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <SettingsIcon aria-hidden className="size-4" />
            </MenuTrigger>
            {/* Returning focus to the gear would blur, and so cancel, a new section's name. */}
            <MenuPopup
              align="end"
              finalFocus={() => useMadoHomuRenamingSection.getState().draft === null}
            >
              <MenuSub>
                <MenuSubTrigger>Change project…</MenuSubTrigger>
                <MenuSubPopup>
                  <MadoHomuProjectMenuItems
                    environmentId={environmentId}
                    onChosen={(id) => {
                      closeSheet();
                      void navigate({ to: "/madohomu", search: { environmentId: id } });
                    }}
                  />
                </MenuSubPopup>
              </MenuSub>
              <MenuItem disabled={!enabled || !project || !canEdit} onClick={addSection}>
                New section…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeSheet();
                  void navigate({
                    to: "/settings/homucode",
                    search: { machine: environmentId },
                    hash: "madohomu-enabled",
                  });
                }}
              >
                MadoHomu settings
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </SidebarHeader>
      <SidebarContent
        fixedHeader={
          enabled ? (
            <div className="flex flex-col px-4 pb-3">
              <Button
                variant="outline"
                size="sm"
                disabled={newThread.creating || !project || !actions.modelSelection || !canEdit}
                onClick={() => void newThread.createThread()}
              >
                <SquarePenIcon aria-hidden className="size-4" />
                New thread
              </Button>
            </div>
          ) : null
        }
      >
        {!enabled ? null : !project ? (
          <p className="p-3 text-xs text-muted-foreground">Choose a project to see its threads.</p>
        ) : (
          <nav
            ref={listRef}
            aria-label="MadoHomu threads"
            className={cn(
              "flex flex-col gap-3 px-2 pb-2",
              sweep !== null && "**:pointer-events-none",
            )}
          >
            {!actions.modelSelection ? (
              <p className="px-1 text-xs text-muted-foreground">
                Set up an agent in Settings to create threads.
              </p>
            ) : null}
            <DndContext
              sensors={sensors}
              modifiers={DND_MODIFIERS}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={endDrag}
            >
              <SortableContext items={manualIds} strategy={verticalListSortingStrategy}>
                {manualGroups.map((group) => {
                  const custom =
                    group.kind === "custom"
                      ? settings.madohomuSections.find((s) => s.id === group.id)
                      : undefined;
                  if (custom) {
                    return section(
                      group,
                      <CustomSectionHeader
                        section={custom}
                        count={group.threads.length}
                        attention={attention(group)}
                        expanded={isExpanded(group)}
                        onToggle={() => toggleExpanded(group)}
                        renaming={renamingSection === custom.id}
                        canEdit={canEdit}
                        onRename={(name) => renameSection(custom.id, name)}
                        onCancelRename={() => setRenamingSection(null)}
                        onMenu={(position) => void openSectionMenu(custom, position)}
                      />,
                      "Drag threads here, or use Move to in a thread's menu.",
                    );
                  }
                  return section(
                    group,
                    heading(
                      group,
                      canEdit ? (
                        <HeadingButton label="Add section" onClick={addSection}>
                          <PlusIcon aria-hidden className="size-3.5" />
                        </HeadingButton>
                      ) : null,
                    ),
                    madohomuEmptyPinnedText({ hasThreads: threads.length > 0, canDrag: canEdit }),
                  );
                })}
                {draftSection !== null ? (
                  <CustomSectionHeader
                    key={draftSection.id}
                    section={{ id: draftSection.id, name: "" }}
                    count={0}
                    attention={0}
                    expanded
                    onToggle={() => {}}
                    renaming
                    canEdit={canEdit}
                    onRename={commitDraftSection}
                    onCancelRename={clearDraftSection}
                    onMenu={() => {}}
                  />
                ) : null}
              </SortableContext>
              <SortableContext
                items={groups
                  .filter((g) => g.kind === "working" || g.kind === "scratch")
                  .flatMap((g) => g.threads.map((t) => t.id))}
                strategy={NO_SORTING}
              >
                {groups
                  .filter(
                    (g) =>
                      (g.kind === "working" && g.threads.length > 0) ||
                      (g.kind === "scratch" && (g.threads.length > 0 || draggingPinned)),
                  )
                  .map((group) =>
                    section(
                      group,
                      heading(group),
                      group.kind === "scratch"
                        ? `Drop here to move to ${MADOHOMU_SCRATCH_LABEL}.`
                        : null,
                    ),
                  )}
              </SortableContext>
              {groups
                .filter(
                  (g) =>
                    (g.kind === "snoozed" && g.threads.length > 0) ||
                    (g.kind === "settled" && (settledCount > 0 || settledPaging)),
                )
                .map((group) => section(group, heading(group)))}
              <DragOverlay modifiers={OVERLAY_MODIFIERS} dropAnimation={null}>
                {draggingThread ? (
                  <DraggedRow
                    title={draggingThread.title}
                    icon={settings.madohomuThreads[draggingThread.id]?.icon ?? null}
                    color={madohomuIconColor(
                      draggingThread.id,
                      settings.madohomuThreads[draggingThread.id]?.color,
                    )}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </nav>
        )}
      </SidebarContent>
      <SidebarFooter>
        <Link to="/" className={cn(QUIET_BUTTON_CLASS, "text-sm")}>
          <AppWindowIcon aria-hidden className="size-4" />
          Open T3 Code
        </Link>
      </SidebarFooter>
      {threadMenu.editor}
    </>
  );
}

const QUIET_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const HEADING_BUTTON_CLASS =
  "inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover/section:opacity-100 pointer-coarse:opacity-100";

function HeadingButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={HEADING_BUTTON_CLASS}
            onClick={onClick}
          >
            {children}
          </button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Every section heading: a chevron that collapses it, its name, its own buttons, its count. */
function SectionHeading({
  id,
  title,
  count,
  attention,
  expanded,
  onToggle,
  actions,
  onContextMenu,
  autoFocus,
}: {
  id: string;
  title: string;
  count: number | string;
  attention: number;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  onContextMenu?: (event: MouseEvent) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="group/section flex items-center gap-1" onContextMenu={onContextMenu}>
      <button
        type="button"
        id={id}
        autoFocus={autoFocus}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onToggle}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <span className="truncate">{title}</span>
      </button>
      {attention > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`${attention} need you. Expand ${title}`}
                className="inline-flex items-center gap-0.5 rounded-full bg-warning/25 px-1.5 text-xs font-medium text-warning-foreground tabular-nums outline-none hover:bg-warning/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={onToggle}
              />
            }
          >
            <ShieldQuestionIcon aria-hidden className="size-3 shrink-0" />
            {attention}
          </TooltipTrigger>
          <TooltipPopup side="top">{attention} need you</TooltipPopup>
        </Tooltip>
      ) : null}
      {actions}
      <span className="pr-1 text-xs text-muted-foreground tabular-nums">{count}</span>
    </div>
  );
}

/** What follows the pointer while a row is dragged, so it can leave its own section. */
function DraggedRow({ title, icon, color }: { title: string; icon: string | null; color: string }) {
  return (
    <div className="flex h-full cursor-grabbing items-center gap-2 rounded-md bg-sidebar-row-active px-2 text-sm text-sidebar-foreground shadow-lg">
      <MadoHomuIcon icon={icon} color={color} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </div>
  );
}

/** A section with its heading and rows; the whole section is the drop target. */
function SectionBlock({
  group,
  header,
  children,
  droppable,
  highlighted,
  insertionAtEnd,
  empty,
}: {
  group: Group;
  header: ReactNode;
  children: ReactNode;
  droppable: boolean;
  highlighted: boolean;
  insertionAtEnd: boolean;
  empty: string | null;
}) {
  const { setNodeRef } = useDroppable({
    id: `${SECTION_DROP_PREFIX}${group.id}`,
    disabled: !droppable,
  });
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`madohomu-section-${group.id}`}
      className={cn(
        "flex flex-col gap-0.5 rounded-md",
        highlighted && "bg-sidebar-row-hover/60",
        insertionAtEnd && "relative",
      )}
      data-madohomu-section={group.kind}
    >
      {header}
      {empty !== null ? (
        <p className="px-1 py-1 text-xs text-muted-foreground/75">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">{children}</ul>
      )}
      {insertionAtEnd ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary"
        />
      ) : null}
    </section>
  );
}

function CustomSectionHeader({
  section,
  count,
  attention,
  expanded,
  onToggle,
  renaming,
  canEdit,
  onRename,
  onCancelRename,
  onMenu,
}: {
  section: MadoHomuSection;
  count: number;
  attention: number;
  expanded: boolean;
  onToggle: () => void;
  renaming: boolean;
  canEdit: boolean;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onMenu: (position: { x: number; y: number }) => void;
}) {
  const settledRef = useRef(false);
  // Enter and Escape remove the focused input; focus its heading instead of letting the
  // workspace hand focus back to the open thread's row, which would open that row's tooltip.
  const [focusHeading, setFocusHeading] = useState(false);
  if (renaming) {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") {
        settledRef.current = true;
        setFocusHeading(true);
        onRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        settledRef.current = true;
        setFocusHeading(true);
        onCancelRename();
      }
    };
    return (
      <input
        id={`madohomu-section-${section.id}`}
        autoFocus
        defaultValue={section.name}
        placeholder="New section"
        aria-label="Section name"
        maxLength={MADOHOMU_SECTION_NAME_MAX_LENGTH}
        onFocus={(event) => {
          settledRef.current = false;
          setFocusHeading(false);
          event.currentTarget.select();
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (settledRef.current) return;
          if (event.relatedTarget === null) setFocusHeading(true);
          onRename(event.currentTarget.value);
        }}
        className="w-full rounded-sm bg-card px-1 text-xs font-medium outline-none ring-1 ring-inset ring-input focus:ring-foreground"
      />
    );
  }
  return (
    <SectionHeading
      id={`madohomu-section-${section.id}`}
      title={section.name}
      count={count}
      attention={attention}
      expanded={expanded}
      onToggle={onToggle}
      autoFocus={focusHeading}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
      actions={
        canEdit ? (
          <HeadingButton
            label={`Section actions for ${section.name}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <EllipsisIcon aria-hidden className="size-3.5" />
          </HeadingButton>
        ) : null
      }
    />
  );
}
