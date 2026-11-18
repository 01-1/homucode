import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { MenuAction } from "@react-native-menu/menu";
import {
  findUntouchedMadoHomuThread,
  groupMadoHomuThreads,
  MADOHOMU_SCRATCH_LABEL,
  MADOHOMU_SCRATCH_PAGE,
  madohomuEmptyPinnedText,
  madohomuIconColor,
  isMadoHomuThreadPinned,
} from "@t3tools/client-runtime/madohomu";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  isListedThreadLineage,
  MADOHOMU_SECTION_NAME_MAX_LENGTH,
  type ThreadId,
} from "@t3tools/contracts";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { uuidv4 } from "../../lib/uuid";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useVisibleThreadShells } from "../../state/entities";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { useEnvironmentScope } from "../../state/session";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useThreadListActions } from "../home/useThreadListActions";
import { openSettings } from "../settings/settings-navigation";
import { ThreadListV2Row, ThreadListV2Section } from "../threads/thread-list-v2-items";
import { useThreadRowProviderInstanceResolver } from "../threads/thread-provider-instance";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import { useThreadListNow } from "../threads/use-thread-list-now";
import {
  buildMadoHomuListRows,
  dropMadoHomuThread,
  madohomuDropPatch,
  moveMadoHomuThread,
  type MadoHomuDrop,
  type MadoHomuListRow,
} from "./madohomuList";
import { MadoHomuIcon } from "./MadoHomuIcon";
import { MadoHomuProjectPicker } from "./MadoHomuProjectPicker";
import { MadoHomuReorderList, type MadoHomuReorderThread } from "./MadoHomuReorderList";
import { MadoHomuThreadEditor } from "./MadoHomuThreadEditor";
import { useMadoHomuActions } from "./useMadoHomuActions";

export function MadoHomuRouteScreen(props: StaticScreenProps<{ readonly environmentId: string }>) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  return <MadoHomuWorkspace key={environmentId} environmentId={environmentId} />;
}

const T3_PIN_MENU_TITLES = { pin: "Pin in T3 Code", unpin: "Unpin in T3 Code" } as const;

// Sections flipped from their default open state, kept while the app runs so leaving the screen
// keeps them.
let rememberedToggled: ReadonlySet<string> = new Set();

function promptSectionName(title: string, initialValue: string, onName: (name: string) => void) {
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

/** Pinned and custom sections for Reorder mode, and the other sections' headers to dim. */
function reorderSectionsOf(
  rows: ReadonlyArray<MadoHomuListRow>,
  leading: (thread: EnvironmentThreadShell) => ReactNode,
) {
  const sections: { id: string; title: string; threads: MadoHomuReorderThread[] }[] = [];
  const dimmed: string[] = [];
  for (const row of rows) {
    if (row.type === "more") continue;
    const manual = row.kind === "pinned" || row.kind === "custom";
    if (row.type === "section") {
      if (manual) sections.push({ id: row.id, title: row.title, threads: [] });
      else dimmed.push(`${row.title} (${row.count})`);
    } else if (row.type === "thread" && manual) {
      const thread = row.row.item.thread;
      sections
        .at(-1)
        ?.threads.push({ id: thread.id, title: thread.title, leading: leading(thread) });
    }
  }
  return { sections, dimmed };
}

function MadoHomuWorkspace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const listActions = useThreadListActions();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => rememberedToggled);
  const [scratchCount, setScratchCount] = useState(MADOHOMU_SCRATCH_PAGE);
  const [choosingProject, setChoosingProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  // A drop shows at once and holds until the next settings arrive from the server.
  const [pendingDrop, setPendingDrop] = useState<{
    readonly base: object;
    readonly threadId: ThreadId;
    readonly drop: MadoHomuDrop;
  } | null>(null);
  const pending = useRef(false);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canEdit = actions.canWrite && canOperate;
  const queuedThreadKeys = useQueuedThreadKeys();
  const openThreadPullRequests = useOpenThreadPullRequests();
  const {
    providersByEnvironmentId,
    machineByEnvironmentId,
    settlementEnvironmentIds,
    snoozeEnvironmentIds,
    snoozePresetsByEnvironmentId,
    pinningEnvironmentIds,
    autoSettleOptOutEnvironmentIds,
    titleRegenerationEnvironmentIds,
  } = useAtomValue(threadListEnvironmentsAtom);
  const resolveProviderInstance = useThreadRowProviderInstanceResolver(providersByEnvironmentId);
  const { settings: savedSettings } = actions;
  const dropPatch =
    pendingDrop && pendingDrop.base === savedSettings
      ? madohomuDropPatch(savedSettings, pendingDrop.threadId, pendingDrop.drop)
      : null;
  const settings = dropPatch
    ? {
        ...savedSettings,
        madohomuThreadOrder: dropPatch.madohomuThreadOrder,
        madohomuThreads: { ...savedSettings.madohomuThreads, ...dropPatch.madohomuThreads },
      }
    : savedSettings;
  const threads = useVisibleThreadShells().filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === actions.project?.id &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      // Subagents and side chats report to their parent; only ones the user filed get a row.
      (isListedThreadLineage(thread.lineage) || settings.madohomuThreads[thread.id] !== undefined),
  );
  const now = useThreadListNow(threads);
  // Reorder mode needs a project to edit; without one the screen shows the picker instead.
  const reorderMode = reordering && settings.madohomuEnabled && actions.project !== null;
  const rows = buildMadoHomuListRows({
    threads,
    settings,
    now,
    toggled,
    scratchCount,
    keepManualOpen: reorderMode,
    snoozeEnvironmentIds,
    queuedThreadKeys,
    isWorking: isThreadWorking,
  });
  const edited = threads.find((thread) => thread.id === editing);
  const open = (threadId: ThreadId) =>
    navigation.dispatch(StackActions.push("Thread", { environmentId, threadId, madohomu: true }));
  const create = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    await (async () => {
      // An untouched empty thread from an earlier "New thread" is reused, not duplicated.
      const untouched = findUntouchedMadoHomuThread(
        groupMadoHomuThreads(threads, settings, { now })
          .filter((group) => group.kind === "pinned" || group.kind === "custom")
          .flatMap((group) => group.threads),
        settings,
      );
      const threadId = untouched?.id ?? (await actions.createThread());
      if (threadId) open(threadId);
    })().finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  const toggleSection = (id: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      rememberedToggled = next;
      return next;
    });
  const addSection = () =>
    promptSectionName("New section", "", (name) => void actions.addSection(name));
  const handleSwipeableWillOpen = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current !== methods) {
      openSwipeableRef.current?.close();
      openSwipeableRef.current = methods;
    }
  };
  const handleSwipeableClose = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current === methods) openSwipeableRef.current = null;
  };
  const newThreadOnBranch = (thread: EnvironmentThreadShell) =>
    navigation.dispatch(
      StackActions.push("Thread", {
        draft: {
          requestId: uuidv4(),
          environmentId: String(thread.environmentId),
          projectId: String(thread.projectId),
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          madohomu: true,
        },
      }),
    );

  const stepThread = (threadId: ThreadId, direction: "up" | "down") => {
    const order = moveMadoHomuThread({ threads, settings, now, threadId, direction });
    if (order) void actions.setThreadOrder(order);
  };
  const dropThread = (threadId: ThreadId, sectionId: string, index: number) => {
    if (!canEdit) return false;
    const drop = dropMadoHomuThread({ threads, settings, now, threadId, sectionId, index });
    if (!drop) return false;
    const pending = { base: savedSettings, threadId, drop };
    setPendingDrop(pending);
    void actions.dropThread(threadId, drop).then((saved) => {
      if (!saved) setPendingDrop((current) => (current === pending ? null : current));
    });
    return true;
  };
  const leadingOf = (thread: EnvironmentThreadShell) => {
    const entry = settings.madohomuThreads[thread.id];
    return (
      <MadoHomuIcon
        icon={entry?.icon ?? null}
        color={madohomuIconColor(thread.id, entry?.color)}
        size={18}
      />
    );
  };

  const madohomuMenu = (row: Extract<MadoHomuListRow, { type: "thread" }>): MenuAction[] => {
    const entry = settings.madohomuThreads[row.row.item.thread.id];
    const pinned = isMadoHomuThreadPinned(entry);
    const filedIn = settings.madohomuSections.some((section) => section.id === entry?.section)
      ? entry?.section
      : null;
    const disabled = { disabled: !canEdit };
    const manual = row.kind === "pinned" || row.kind === "custom";
    return [
      { id: "extra:edit", title: "Edit", image: "slider.horizontal.3", attributes: disabled },
      {
        id: "extra:move",
        title: "Move to",
        image: "folder",
        subactions: [
          {
            id: "extra:section:",
            title: "Pinned",
            image: "pin",
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
          {
            id: "extra:new-section",
            title: "New section…",
            image: "plus",
            attributes: disabled,
          },
        ],
      },
      ...(manual
        ? [
            {
              id: "extra:up",
              title: "Move up",
              image: "arrow.up",
              attributes: { disabled: !canEdit || !row.canMoveUp },
            } satisfies MenuAction,
            {
              id: "extra:down",
              title: "Move down",
              image: "arrow.down",
              attributes: { disabled: !canEdit || !row.canMoveDown },
            } satisfies MenuAction,
          ]
        : []),
    ];
  };
  const handleMadoHomuAction = (thread: EnvironmentThreadShell, event: string) => {
    if (!canEdit) return;
    if (event === "extra:edit") setEditing(thread.id);
    else if (event === "extra:scratch") void actions.setThreadPlace(thread.id, null);
    else if (event === "extra:new-section") {
      promptSectionName("New section", "", (name) => {
        const id = uuidv4();
        void actions
          .save({ madohomuSections: [...settings.madohomuSections, { id, name }] })
          .then((saved) => (saved ? actions.setThreadPlace(thread.id, { section: id }) : false));
      });
    } else if (event.startsWith("extra:section:")) {
      const section = event.slice("extra:section:".length);
      void actions.setThreadPlace(thread.id, { section: section || null });
    } else if (event === "extra:up" || event === "extra:down") {
      stepThread(thread.id, event === "extra:up" ? "up" : "down");
    }
  };

  const renderRow = ({ item }: { readonly item: MadoHomuListRow }) => {
    if (item.type === "section") {
      const label = `${item.title} (${item.count})`;
      const badge =
        item.attention > 0 ? (
          <View className="shrink-0 rounded-full border border-warning-border bg-warning px-1.5">
            <Text className="text-2xs font-t3-medium text-warning-foreground">
              {item.attention}
            </Text>
          </View>
        ) : undefined;
      const disclosure =
        item.expanded === null
          ? undefined
          : {
              expanded: item.expanded,
              onToggle: () => toggleSection(item.id),
              accessibilityLabel: `${item.title}, ${item.count} ${item.count === 1 ? "thread" : "threads"}${item.attention > 0 ? `, ${item.attention} need you` : ""}`,
              accessibilityHint: `${item.expanded ? "Collapses" : "Expands"} the section.`,
            };
      const heading = (accessory?: ReactNode) => (
        <ThreadListV2Section
          label={label}
          badge={badge}
          tone={item.kind === "snoozed" ? "snoozed" : "default"}
          {...(disclosure ? { disclosure } : {})}
          accessory={accessory}
        />
      );
      if (item.kind !== "custom") return heading();
      const index = settings.madohomuSections.findIndex((section) => section.id === item.id);
      const sectionEdit = { disabled: !canEdit };
      // The heading's tap folds the section, so the section menu opens from its own button.
      return heading(
        <Menu
          accessibilityLabel={`${item.title} section actions`}
          actions={[
            {
              id: "rename",
              title: "Rename section",
              image: "square.and.pencil",
              attributes: sectionEdit,
            },
            {
              id: "up",
              title: "Move up",
              image: "arrow.up",
              attributes: { disabled: !canEdit || index <= 0 },
            },
            {
              id: "down",
              title: "Move down",
              image: "arrow.down",
              attributes: {
                disabled: !canEdit || index < 0 || index >= settings.madohomuSections.length - 1,
              },
            },
            {
              id: "delete",
              title: "Delete section",
              image: "trash",
              attributes: { destructive: true, disabled: !canEdit },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (!canEdit) return;
            if (nativeEvent.event === "up" || nativeEvent.event === "down")
              void actions.moveSection(item.id, nativeEvent.event);
            if (nativeEvent.event === "rename")
              promptSectionName(
                "Rename section",
                item.title,
                (name) => void actions.renameSection(item.id, name),
              );
            if (nativeEvent.event === "delete")
              Dialog.confirm({
                title: `Delete “${item.title}”?`,
                message: "Its threads move back to Pinned.",
                confirmText: "Delete",
                destructive: true,
                onConfirm: () => void actions.deleteSection(item.id),
              });
          }}
        >
          <View className="px-1 py-1">
            <SymbolView
              name="ellipsis"
              size={14}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
          </View>
        </Menu>,
      );
    }
    if (item.type === "empty") {
      return (
        <Text className="px-5 py-2 text-sm text-foreground-muted">
          {madohomuEmptyPinnedText({ hasThreads: threads.length > 0, canDrag: false })}
        </Text>
      );
    }
    if (item.type === "more") {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show more, ${item.count} more ${item.count === 1 ? "thread" : "threads"}`}
          onPress={() => setScratchCount((count) => count + MADOHOMU_SCRATCH_PAGE)}
          className="px-5 py-3"
        >
          <Text className="text-sm text-foreground-muted">Show more ({item.count})</Text>
        </Pressable>
      );
    }
    const { row } = item;
    const thread = row.item.thread;
    return (
      <ThreadListV2Row
        thread={thread}
        variant={row.item.variant}
        hasQueuedMessages={row.hasQueuedMessages}
        snoozed={row.item.snoozed}
        pinned={row.item.pinned}
        wokeAt={row.item.wokeAt}
        snoozePresetMinute={row.snoozePresetMinute ?? ""}
        snoozeWakeLabelText={row.snoozeWakeLabelText}
        timeLabel={row.timeLabel}
        showTrailingDivider={row.showTrailingDivider}
        project={null}
        leading={leadingOf(thread)}
        providerInstance={resolveProviderInstance(thread)}
        providers={providersByEnvironmentId.get(thread.environmentId)}
        environmentLabel={null}
        environmentMachine={machineByEnvironmentId.get(thread.environmentId)}
        onSelectThread={(selected) => open(selected.id)}
        onOpenThreadPullRequests={(selected, pr) => {
          openSwipeableRef.current?.close();
          openThreadPullRequests(selected, pr);
        }}
        onDeleteThread={listActions.confirmDeleteThread}
        onArchiveThread={listActions.archiveThread}
        onNewThreadOnBranch={newThreadOnBranch}
        onRenameThread={listActions.renameThread}
        onRegenerateThreadTitle={listActions.regenerateThreadTitle}
        titleRegenerationSupported={titleRegenerationEnvironmentIds.has(thread.environmentId)}
        settlementSupported={settlementEnvironmentIds.has(thread.environmentId)}
        onSettleThread={listActions.settleThread}
        snoozeSupported={snoozeEnvironmentIds.has(thread.environmentId)}
        snoozePresets={snoozePresetsByEnvironmentId.get(thread.environmentId)}
        pinningSupported={pinningEnvironmentIds.has(thread.environmentId)}
        autoSettleOptOutSupported={autoSettleOptOutEnvironmentIds.has(thread.environmentId)}
        onSnoozeThread={listActions.snoozeThread}
        onUnsnoozeThread={listActions.unsnoozeThread}
        onUnsettleThread={listActions.unsettleThread}
        onPinThread={listActions.pinThread}
        onUnpinThread={listActions.unpinThread}
        onSetThreadAutoSettle={listActions.setThreadAutoSettle}
        onSwipeableClose={handleSwipeableClose}
        onSwipeableWillOpen={handleSwipeableWillOpen}
        pinMenuTitles={T3_PIN_MENU_TITLES}
        extraMenuActions={madohomuMenu(item)}
        onExtraMenuAction={handleMadoHomuAction}
      />
    );
  };

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="MadoHomu"
        onBack={() => navigation.goBack()}
        {...(reorderMode
          ? { confirm: { label: "Done", onPress: () => setReordering(false) } }
          : {})}
        actions={
          !reorderMode && settings.madohomuEnabled && actions.project && canEdit
            ? [
                {
                  icon: "line.3.horizontal" as const,
                  accessibilityLabel: "Reorder pinned threads",
                  onPress: () => {
                    openSwipeableRef.current?.close();
                    setReordering(true);
                  },
                },
                {
                  icon: "folder.badge.plus" as const,
                  accessibilityLabel: "New section",
                  onPress: addSection,
                },
              ]
            : []
        }
        menus={
          reorderMode
            ? []
            : [
                {
                  title: "MadoHomu options",
                  icon: "gearshape",
                  items: [
                    ...(settings.madohomuEnabled
                      ? [
                          {
                            id: "project",
                            title: "Change project…",
                            icon: "folder",
                            disabled: !actions.canWrite,
                            onPress: () => {
                              openSwipeableRef.current?.close();
                              setChoosingProject(true);
                            },
                          },
                        ]
                      : []),
                    {
                      id: "settings",
                      title: "MadoHomu settings",
                      icon: "gearshape",
                      onPress: () => openSettings(navigation, "SettingsMadoHomu"),
                    },
                  ],
                },
              ]
        }
      />
      {!settings.madohomuEnabled ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 p-5"
        >
          <Text className="text-base text-foreground-muted">
            Enable MadoHomu in Settings to use it.
          </Text>
          <Button
            label="MadoHomu settings"
            onPress={() => openSettings(navigation, "SettingsMadoHomu")}
          />
        </ScrollView>
      ) : !actions.project ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 p-5"
        >
          <Text className="text-base text-foreground">
            Make a new project for MadoHomu to focus on, or choose one you already have.
          </Text>
          <MadoHomuProjectPicker
            environmentId={environmentId}
            projectId={settings.madohomuProjectId}
            disabled={!actions.canWrite}
            onChange={(madohomuProjectId) => void actions.save({ madohomuProjectId })}
          />
        </ScrollView>
      ) : reorderMode ? (
        <MadoHomuReorderList
          {...reorderSectionsOf(rows, leadingOf)}
          // One drop at a time: the next settings push would drop a second pending one early.
          disabled={!canEdit || dropPatch !== null}
          bottomInset={Math.max(insets.bottom, 18) + 18}
          onDrop={dropThread}
          onStep={stepThread}
        />
      ) : (
        <LegendList
          data={rows}
          extraData={{ settings, canEdit }}
          renderScrollComponent={NativeScrollView}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.type}
          contentInsetAdjustmentBehavior="automatic"
          onScrollBeginDrag={() => openSwipeableRef.current?.close()}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
          ListHeaderComponent={
            <View className="gap-3 px-5 py-3">
              <Button
                label="New thread"
                icon="plus"
                size="compact"
                loading={busy}
                disabled={!actions.canCreate || !actions.canWrite || !actions.modelSelection}
                onPress={() => void create()}
              />
              {!actions.modelSelection ? (
                <Text className="text-sm text-foreground-muted">
                  Set up an agent in Settings to create threads.
                </Text>
              ) : null}
            </View>
          }
          renderItem={renderRow}
        />
      )}
      {settings.madohomuEnabled && choosingProject ? (
        <Sheet title="Change project" onClose={() => setChoosingProject(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 p-5 pb-12"
          >
            <MadoHomuProjectPicker
              environmentId={environmentId}
              projectId={settings.madohomuProjectId}
              disabled={!actions.canWrite}
              allowClear={false}
              onChange={(madohomuProjectId) => {
                setChoosingProject(false);
                void actions.save({ madohomuProjectId });
              }}
            />
          </ScrollView>
        </Sheet>
      ) : null}
      {settings.madohomuEnabled && edited ? (
        <MadoHomuThreadEditor
          key={edited.id}
          environmentId={environmentId}
          thread={edited}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}
