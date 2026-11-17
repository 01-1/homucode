import { useAtomValue } from "@effect/atom-react";
import { DndContext, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  groupMadoHomuThreads,
  isMadoHomuThreadPinned,
  MADOHOMU_SCRATCH_LABEL,
  madohomuIconColor,
  reorderMadoHomuThreads,
  type MadoHomuGroup,
} from "@t3tools/client-runtime/madohomu";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import {
  AuthOrchestrationOperateScope,
  MADOHOMU_SECTION_NAME_MAX_LENGTH,
  type ContextMenuItem,
  type EnvironmentId,
  type MadoHomuSection,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  ChevronRightIcon,
  EllipsisIcon,
  PlusIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadActionMenu, type ThreadActionMenuExtras } from "../../hooks/useThreadActionMenu";
import { useAcknowledgeThreadWoke, useThreadActions } from "../../hooks/useThreadActions";
import { randomUUID, cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useServerConfigs, useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import type { SidebarThreadSummary } from "../../types";
import { canShareWithGuestAtom } from "../chat/guestShareAvailability";
import { sidebarProviderEntriesAtom } from "../Sidebar";
import { isTrailingDoubleClick, useSnoozeWakeClock } from "../Sidebar.logic";
import { SidebarPointerSensor } from "../Sidebar.pointer";
import { snoozeWakeLabel, type SnoozePreset } from "../Sidebar.snooze";
import { SortableThreadRow, type SidebarProviderEntry } from "../sidebar/SidebarThreadRow";
import { Button } from "../ui/button";
import { SidebarContent, SidebarFooter, SidebarHeader, useSidebar } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MadoHomuIcon } from "./MadoHomuIcon";
import { MadoHomuThreadEditor } from "./MadoHomuThreadEditor";
import { useMadoHomuActions } from "./useMadoHomuActions";
import { useMadoHomuEnvironmentId } from "./useMadoHomuEnvironmentId";

const SNOOZED_EXPANDED_KEY = "t3code:madohomu:snoozed-expanded";
const SETTLED_EXPANDED_KEY = "t3code:madohomu:settled-expanded";
const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
// useSensor memoizes on its options, so they live outside render.
const POINTER_SENSOR_OPTIONS = { distance: 6, onAttach: () => {}, onFinish: () => {} };
const DND_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];
const SECTION_DROP_PREFIX = "madohomu-section:";
const MENU_EDIT = "madohomu:edit";
const MENU_MOVE = "madohomu:move";
const MENU_NEW_SECTION = "madohomu:new-section";
const MENU_SCRATCH = "madohomu:scratch";
const MENU_SECTION_PREFIX = "madohomu:section:";
const readOpensPullRequestsInRightPanel = () => false;
const ignoreSweep = () => {};

type Group = MadoHomuGroup<SidebarThreadSummary>;
/** The custom section a manual group files threads under; null is Pinned. */
const groupSection = (group: Group) => (group.kind === "custom" ? group.id : null);

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
  return environmentId ? <MadoHomuThreadList environmentId={environmentId} /> : null;
}

function MadoHomuThreadList({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const { settings, project } = actions;
  const search = useSearch({ from: "/_chat/madohomu" });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canEdit = canOperate && actions.canWrite;
  const threads = useVisibleThreadShells().filter(
    (t) =>
      t.environmentId === environmentId &&
      t.projectId === project?.id &&
      t.deletedAt === null &&
      t.archivedAt === null &&
      // Subagents report to their parent; only ones the user filed get a row, as in T3 Code.
      (t.lineage.relationshipToParent !== "subagent" ||
        settings.madohomuThreads[t.id] !== undefined),
  );
  const clockMs = useSnoozeWakeClock(threads);
  const now = new Date(clockMs).toISOString();
  const groups = groupMadoHomuThreads(threads, settings, { now });
  const manualGroups = groups.filter((g) => g.kind === "pinned" || g.kind === "custom");
  const manualIds = manualGroups.flatMap((g) => g.threads.map((t) => t.id));

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
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const [renaming, setRenaming] = useState<{ id: ThreadId; title: string } | null>(null);
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const serverConfigs = useServerConfigs();
  const configLoaded = serverConfigs.has(environmentId);
  const providerEntries =
    useAtomValue(sidebarProviderEntriesAtom).get(environmentId) ?? EMPTY_PROVIDER_ENTRIES;
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const canShareWithGuest = useAtomValue(canShareWithGuestAtom(environmentId));
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const { settleThread, unsettleThread, snoozeThread, unsnoozeThread, confirmAndUnpinThread } =
    useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const open = (threadId: ThreadId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/madohomu", search: { environmentId, threadId } });
  };
  const startRename = (threadRef: ScopedThreadRef) => {
    const thread = threads.find((t) => t.id === threadRef.threadId);
    if (thread) setRenaming({ id: thread.id, title: thread.title });
  };
  const { openMenu } = useThreadActionMenu({
    threadRef: null,
    projectCwd: project?.workspaceRoot ?? null,
    onStartRename: startRename,
    canShareWithGuest,
  });

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
      labels: {
        pin: "Pin in T3 Code",
        unpin: "Unpin in T3 Code",
        folder: "Move to T3 Code folder",
      },
      onSelect: (id) => {
        if (id === MENU_EDIT) setEditing(threadId);
        else if (id === MENU_SCRATCH) {
          if (pinned) void actions.patchThread(threadId, { pinned: false });
        } else if (id === MENU_NEW_SECTION) {
          const created = { id: randomUUID(), name: "New section" };
          void actions
            .save({
              madohomuSections: [...settings.madohomuSections, created],
              madohomuThreadOrder: reorderMadoHomuThreads(savedOrder(), threadId, null),
              madohomuThreads: {
                [threadId]: actions.threadEntry(threadId, { pinned: true, section: created.id }),
              },
            })
            .then((saved) => {
              if (saved) setRenamingSection(created.id);
            });
        } else if (id.startsWith(MENU_SECTION_PREFIX)) {
          const target = id.slice(MENU_SECTION_PREFIX.length) || null;
          if (!pinned || target !== section) void fileThread(threadId, target, null);
        }
      },
    };
  };

  const handleThreadClick = useStableCallback((event: MouseEvent, threadRef: ScopedThreadRef) => {
    if (isTrailingDoubleClick(event.detail)) return;
    open(threadRef.threadId);
  });
  const handleActivate = useStableCallback((threadRef: ScopedThreadRef) =>
    open(threadRef.threadId),
  );
  const handleEdit = useStableCallback((threadRef: ScopedThreadRef) => {
    if (canEdit) setEditing(threadRef.threadId);
  });
  const handleRenameTitleChange = useStableCallback((title: string) =>
    setRenaming((current) => (current ? { ...current, title } : current)),
  );
  const handleCancelRename = useStableCallback(() => setRenaming(null));
  const handleCommitRename = useStableCallback((threadRef: ScopedThreadRef, title: string) => {
    const original = threads.find((t) => t.id === threadRef.threadId)?.title;
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
  const handleContextMenu = useStableCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) =>
      openMenu(position, {
        threadRef,
        extras: menuExtras(threadRef.threadId),
        isSettled: groups
          .find((g) => g.kind === "settled")
          ?.threads.some((t) => t.id === threadRef.threadId),
      }),
  );
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

  const createThread = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    await actions
      .createThread()
      .then((id) => {
        if (id) open(id);
      })
      .finally(() => {
        creatingRef.current = false;
        setCreating(false);
      });
  };

  const saveSections = (sections: ReadonlyArray<MadoHomuSection>) =>
    actions.save({ madohomuSections: [...sections] });
  const addingSectionRef = useRef(false);
  const addSection = async () => {
    if (addingSectionRef.current) return;
    addingSectionRef.current = true;
    const section = { id: randomUUID(), name: "New section" };
    const saved = await saveSections([...settings.madohomuSections, section]);
    addingSectionRef.current = false;
    if (saved) setRenamingSection(section.id);
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
          { id: "up", label: "Move up", disabled: !canEdit || index <= 0 },
          {
            id: "down",
            label: "Move down",
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
        api.dialogs.confirm(`Delete section "${section.name}"? Its threads move back to Pinned.`),
      );
      if (confirmed._tag === "Success" && confirmed.value) void deleteSection(section.id);
    }
  };

  const sensors = useSensors(useSensor(SidebarPointerSensor, POINTER_SENSOR_OPTIONS));
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !canEdit) return;
    const moved = String(active.id) as ThreadId;
    const overId = String(over.id);
    if (overId.startsWith(SECTION_DROP_PREFIX)) {
      const group = manualGroups.find((g) => g.id === overId.slice(SECTION_DROP_PREFIX.length));
      if (group) void fileThread(moved, groupSection(group), group.threads[0]?.id ?? null);
      return;
    }
    const group = manualGroups.find((g) => g.threads.some((t) => t.id === overId));
    const from = manualIds.indexOf(moved);
    const to = manualIds.indexOf(overId as ThreadId);
    if (!group || from < 0 || to < 0) return;
    // Like arrayMove: dragging down lands after the row it is over, dragging up before it.
    const before = from < to ? (manualIds[to + 1] ?? null) : (overId as ThreadId);
    void fileThread(moved, groupSection(group), before);
  };

  const row = (group: Group, thread: SidebarThreadSummary) => {
    const isActive = search.threadId === thread.id;
    const entry = settings.madohomuThreads[thread.id];
    const manual = group.kind === "pinned" || group.kind === "custom";
    return (
      <SortableThreadRow
        key={thread.id}
        sortableId={thread.id}
        sortableDisabled={!manual || !canEdit}
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
        isPinned={thread.pinnedAt != null}
        dropVerb={null}
        dragOverPinned={false}
        sweepAction={null}
        snoozeWakeLabelText={
          group.kind === "snoozed" && thread.snoozedUntil != null
            ? snoozeWakeLabel(thread.snoozedUntil, { now })
            : null
        }
        wokeAt={threadWokeAt(thread, { now })}
        isActive={isActive}
        isRouteThread={isActive}
        readOpensPullRequestsInRightPanel={readOpensPullRequestsInRightPanel}
        jumpLabel={null}
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
        onStartRename={handleEdit}
        onRenameTitleChange={handleRenameTitleChange}
        onCommitRename={handleCommitRename}
        onCancelRename={handleCancelRename}
        isRenaming={renaming?.id === thread.id}
        renamingTitle={renaming?.id === thread.id ? renaming.title : ""}
        onContextMenu={handleContextMenu}
        onSettle={handleSettle}
        onActionSweepStart={ignoreSweep}
        onUnsettle={handleUnsettle}
        onSnooze={handleSnooze}
        onUnsnooze={handleUnsnooze}
        onUnpin={handleUnpin}
        onAcknowledgeWoke={acknowledgeWoke}
      />
    );
  };

  const edited = threads.find((t) => t.id === editing);
  const enabled = settings.madohomuEnabled;
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <Link
            to="/madohomu"
            search={{ environmentId }}
            className="min-w-0 flex-1 truncate rounded-sm px-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            MadoHomu
          </Link>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/settings/general"
                  hash="madohomu-enabled"
                  aria-label="MadoHomu settings"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <SettingsIcon aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">MadoHomu settings</TooltipPopup>
          </Tooltip>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {enabled ? (
          <div className="flex flex-col px-2 pb-3">
            <Button
              variant="outline"
              size="sm"
              disabled={creating || !project || !actions.modelSelection || !canEdit}
              onClick={() => void createThread()}
            >
              <SquarePenIcon aria-hidden className="size-4" />
              New thread
            </Button>
          </div>
        ) : null}
        {!enabled ? null : !project ? (
          <p className="p-3 text-xs text-muted-foreground">Choose a project to see its threads.</p>
        ) : (
          <nav aria-label="MadoHomu threads" className="flex flex-col gap-3 px-2 pb-2">
            {!actions.modelSelection ? (
              <p className="px-1 text-xs text-muted-foreground">
                Set up an agent in Settings to create threads.
              </p>
            ) : null}
            <DndContext sensors={sensors} modifiers={DND_MODIFIERS} onDragEnd={handleDragEnd}>
              <SortableContext items={manualIds} strategy={verticalListSortingStrategy}>
                {manualGroups.map((group) => {
                  const section =
                    group.kind === "custom"
                      ? settings.madohomuSections.find((s) => s.id === group.id)
                      : undefined;
                  return (
                    <SectionBlock
                      key={group.id}
                      group={group}
                      droppable
                      header={
                        section ? (
                          <CustomSectionHeader
                            section={section}
                            count={group.threads.length}
                            renaming={renamingSection === section.id}
                            canEdit={canEdit}
                            onRename={(name) => renameSection(section.id, name)}
                            onCancelRename={() => setRenamingSection(null)}
                            onMenu={(position) => void openSectionMenu(section, position)}
                          />
                        ) : (
                          <SectionLabel id={`madohomu-section-${group.id}`}>
                            {group.title}
                          </SectionLabel>
                        )
                      }
                      empty={
                        group.kind === "pinned"
                          ? threads.length === 0
                            ? "No threads yet. Choose New thread to start one."
                            : "Nothing pinned. Drag a thread here or choose Move to Pinned."
                          : "Empty. Drag threads here."
                      }
                    >
                      {group.threads.map((thread) => row(group, thread))}
                    </SectionBlock>
                  );
                })}
              </SortableContext>
              {canEdit ? (
                <button
                  type="button"
                  className="-mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => void addSection()}
                >
                  <PlusIcon aria-hidden className="size-3.5" />
                  Add section
                </button>
              ) : null}
              {groups
                .filter((g) => g.kind === "scratch" && g.threads.length > 0)
                .map((group) => (
                  <SectionBlock
                    key={group.id}
                    group={group}
                    header={
                      <SectionLabel id={`madohomu-section-${group.id}`}>{group.title}</SectionLabel>
                    }
                  >
                    {group.threads.map((thread) => row(group, thread))}
                  </SectionBlock>
                ))}
              {groups
                .filter(
                  (g) => (g.kind === "snoozed" || g.kind === "settled") && g.threads.length > 0,
                )
                .map((group) => {
                  const expanded = group.kind === "snoozed" ? snoozedExpanded : settledExpanded;
                  const setExpanded =
                    group.kind === "snoozed" ? setSnoozedExpanded : setSettledExpanded;
                  return (
                    <SectionBlock
                      key={group.id}
                      group={group}
                      collapsed={!expanded}
                      header={
                        <button
                          type="button"
                          id={`madohomu-section-${group.id}`}
                          aria-expanded={expanded}
                          className="flex w-full items-center gap-1 rounded-sm px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          onClick={() => setExpanded(!expanded)}
                        >
                          <ChevronRightIcon
                            aria-hidden
                            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
                          />
                          {group.title}
                          <span className="ml-auto tabular-nums">{group.threads.length}</span>
                        </button>
                      }
                    >
                      {group.threads.map((thread) => row(group, thread))}
                    </SectionBlock>
                  );
                })}
            </DndContext>
          </nav>
        )}
      </SidebarContent>
      <SidebarFooter>
        <Link to="/" className="px-1 text-sm">
          Open T3 Code
        </Link>
      </SidebarFooter>
      {edited ? (
        <MadoHomuThreadEditor
          key={edited.id}
          environmentId={environmentId}
          thread={edited}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="px-1 text-xs font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

function SectionBlock({
  group,
  header,
  children,
  droppable = false,
  collapsed = false,
  empty,
}: {
  group: Group;
  header: ReactNode;
  children: ReactNode;
  droppable?: boolean;
  collapsed?: boolean;
  empty?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${SECTION_DROP_PREFIX}${group.id}`,
    disabled: !droppable,
  });
  return (
    <section
      aria-labelledby={`madohomu-section-${group.id}`}
      className="flex flex-col gap-0.5"
      data-madohomu-section={group.kind}
    >
      <div ref={setNodeRef} className={cn("rounded-sm", isOver && "bg-sidebar-row-hover")}>
        {header}
      </div>
      {collapsed ? null : group.threads.length === 0 && empty ? (
        <p className="px-1 py-1 text-xs text-muted-foreground/75">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">{children}</ul>
      )}
    </section>
  );
}

function CustomSectionHeader({
  section,
  count,
  renaming,
  canEdit,
  onRename,
  onCancelRename,
  onMenu,
}: {
  section: MadoHomuSection;
  count: number;
  renaming: boolean;
  canEdit: boolean;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onMenu: (position: { x: number; y: number }) => void;
}) {
  const settledRef = useRef(false);
  if (renaming) {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") {
        settledRef.current = true;
        onRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        settledRef.current = true;
        onCancelRename();
      }
    };
    return (
      <input
        id={`madohomu-section-${section.id}`}
        autoFocus
        defaultValue={section.name}
        aria-label="Section name"
        maxLength={MADOHOMU_SECTION_NAME_MAX_LENGTH}
        onFocus={(event) => {
          settledRef.current = false;
          event.currentTarget.select();
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (!settledRef.current) onRename(event.currentTarget.value);
        }}
        className="w-full rounded-sm bg-card px-1 text-xs font-medium outline-none ring-1 ring-inset ring-input focus:ring-foreground"
      />
    );
  }
  return (
    <div
      className="group/section flex items-center gap-1"
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <h3
        id={`madohomu-section-${section.id}`}
        className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground"
      >
        {section.name}
      </h3>
      {canEdit ? (
        <button
          type="button"
          aria-label={`Section actions for ${section.name}`}
          className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover/section:opacity-100 pointer-coarse:opacity-100"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <EllipsisIcon aria-hidden className="size-3.5" />
        </button>
      ) : null}
      <span className="pr-1 text-xs text-muted-foreground tabular-nums">{count}</span>
    </div>
  );
}
