import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { MenuAction } from "@react-native-menu/menu";
import { madohomuIconColor, isMadoHomuThreadPinned } from "@t3tools/client-runtime/madohomu";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  MADOHOMU_SECTION_NAME_MAX_LENGTH,
  type ThreadId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { uuidv4 } from "../../lib/uuid";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useVisibleThreadShells } from "../../state/entities";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { useEnvironmentScope } from "../../state/session";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useThreadListActions } from "../home/useThreadListActions";
import { openSettings } from "../settings/settings-navigation";
import {
  ThreadListV2Row,
  ThreadListV2Section,
  ThreadListV2SettledShelfHeader,
  ThreadListV2SnoozedShelfHeader,
} from "../threads/thread-list-v2-items";
import { useThreadRowProviderInstanceResolver } from "../threads/thread-provider-instance";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import { useThreadListNow } from "../threads/use-thread-list-now";
import { buildMadoHomuListRows, moveMadoHomuThread, type MadoHomuListRow } from "./madohomuList";
import { MadoHomuIcon } from "./MadoHomuIcon";
import { MadoHomuProjectPicker } from "./MadoHomuProjectPicker";
import { MadoHomuThreadEditor } from "./MadoHomuThreadEditor";
import { useMadoHomuActions } from "./useMadoHomuActions";

export function MadoHomuRouteScreen(props: StaticScreenProps<{ readonly environmentId: string }>) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  return <MadoHomuWorkspace key={environmentId} environmentId={environmentId} />;
}

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

function MadoHomuWorkspace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const listActions = useThreadListActions();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
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
  const threads = useVisibleThreadShells().filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === actions.project?.id &&
      thread.archivedAt === null &&
      thread.deletedAt === null,
  );
  const now = useThreadListNow(threads);
  const { settings } = actions;
  const rows = buildMadoHomuListRows({
    threads,
    settings,
    now,
    expanded,
    snoozeEnvironmentIds,
    queuedThreadKeys,
  });
  const edited = threads.find((thread) => thread.id === editing);
  const open = (threadId: ThreadId) =>
    navigation.dispatch(StackActions.push("Thread", { environmentId, threadId, madohomu: true }));
  const create = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    await (async () => {
      const threadId = await actions.createThread();
      if (threadId) open(threadId);
    })().finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  const toggleSection = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
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
        },
      }),
    );

  const madohomuMenu = (row: Extract<MadoHomuListRow, { type: "thread" }>): MenuAction[] => {
    const pinned = isMadoHomuThreadPinned(settings.madohomuThreads[row.row.item.thread.id]);
    const disabled = { disabled: !canEdit };
    const manual = row.kind === "pinned" || row.kind === "custom";
    return [
      { id: "extra:edit", title: "Edit", image: "slider.horizontal.3", attributes: disabled },
      pinned
        ? {
            id: "extra:scratch",
            title: "Move to Scratch",
            image: "pin.slash",
            attributes: disabled,
          }
        : { id: "extra:pin", title: "Move to Pinned", image: "pin", attributes: disabled },
      {
        id: "extra:section",
        title: "Move to section",
        image: "folder",
        subactions: [
          {
            id: "extra:section:",
            title: "Pinned",
            state: pinned && manual && row.kind === "pinned" ? "on" : "off",
            attributes: disabled,
          },
          ...settings.madohomuSections.map((section): MenuAction => ({
            id: `extra:section:${section.id}`,
            title: section.name,
            state: row.sectionId === section.id ? "on" : "off",
            attributes: disabled,
          })),
          { id: "extra:new-section", title: "New section…", image: "plus", attributes: disabled },
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
    else if (event === "extra:pin") void actions.setThreadPlace(thread.id, { section: null });
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
      const order = moveMadoHomuThread({
        threads,
        settings,
        now,
        threadId: thread.id,
        direction: event === "extra:up" ? "up" : "down",
      });
      if (order) void actions.setThreadOrder(order);
    }
  };

  const renderRow = ({ item }: { readonly item: MadoHomuListRow }) => {
    if (item.type === "section") {
      if (item.kind === "snoozed" || item.kind === "settled") {
        const Header =
          item.kind === "snoozed" ? ThreadListV2SnoozedShelfHeader : ThreadListV2SettledShelfHeader;
        return (
          <Header
            count={item.count}
            expanded={item.expanded === true}
            onToggle={() => toggleSection(item.id)}
          />
        );
      }
      if (item.kind !== "custom") return <ThreadListV2Section label={item.title} />;
      return (
        <Menu
          accessibilityLabel={`${item.title} section`}
          actions={[
            { id: "rename", title: "Rename section", image: "square.and.pencil" },
            {
              id: "delete",
              title: "Delete section",
              image: "trash",
              attributes: { destructive: true },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (!canEdit) return;
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
          <ThreadListV2Section label={item.title} />
        </Menu>
      );
    }
    if (item.type === "empty") {
      return (
        <Text className="px-5 py-2 text-sm text-foreground-muted">
          {item.kind === "pinned" ? "Create a thread to start chatting." : "No threads yet."}
        </Text>
      );
    }
    const { row } = item;
    const thread = row.item.thread;
    const entry = settings.madohomuThreads[thread.id];
    return (
      <ThreadListV2Row
        thread={thread}
        variant={row.item.variant}
        hasQueuedMessages={row.hasQueuedMessages}
        snoozed={row.item.snoozed}
        pinned={false}
        wokeAt={row.item.wokeAt}
        snoozePresetMinute={row.snoozePresetMinute ?? ""}
        snoozeWakeLabelText={row.snoozeWakeLabelText}
        timeLabel={row.timeLabel}
        showTrailingDivider={row.showTrailingDivider}
        project={null}
        leading={
          <MadoHomuIcon
            icon={entry?.icon ?? null}
            color={madohomuIconColor(thread.id, entry?.color)}
            size={18}
          />
        }
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
        actions={[
          ...(settings.madohomuEnabled && actions.project && canEdit
            ? [
                {
                  icon: "folder.badge.plus" as const,
                  accessibilityLabel: "New section",
                  onPress: addSection,
                },
              ]
            : []),
          {
            icon: "gearshape",
            accessibilityLabel: "MadoHomu settings",
            onPress: () => openSettings(navigation, "SettingsMadoHomu"),
          },
        ]}
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
          <Text className="text-base text-foreground">Choose the project MadoHomu focuses on.</Text>
          <MadoHomuProjectPicker
            environmentId={environmentId}
            projectId={settings.madohomuProjectId}
            disabled={!actions.canWrite}
            onChange={(madohomuProjectId) => void actions.save({ madohomuProjectId })}
          />
        </ScrollView>
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
