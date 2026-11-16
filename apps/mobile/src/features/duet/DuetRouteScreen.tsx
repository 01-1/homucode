import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { LegendList } from "@legendapp/list/react-native";
import {
  duetIconColor,
  duetTaskLabel,
  isDuetThreadPinned,
  orderDuetTasks,
  orderDuetThreads,
} from "@t3tools/client-runtime/duet";
import { AuthOrchestrationOperateScope, EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { openSettings } from "../settings/settings-navigation";
import { DuetIcon } from "./DuetIcon";
import { DuetProjectPicker } from "./DuetProjectPicker";
import { DuetThreadEditor } from "./DuetThreadEditor";
import { useDuetActions } from "./useDuetActions";

export function DuetRouteScreen(props: StaticScreenProps<{ readonly environmentId: string }>) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  return <DuetWorkspace key={environmentId} environmentId={environmentId} />;
}

function DuetWorkspace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const actions = useDuetActions(environmentId);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"chat" | "tasks">("chat");
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const threads = useVisibleThreadShells().filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === actions.project?.id &&
      thread.archivedAt === null &&
      thread.deletedAt === null,
  );
  const rows =
    tab === "tasks"
      ? orderDuetTasks(threads)
      : orderDuetThreads(threads, actions.settings.duetThreads);
  const edited = threads.find((thread) => thread.id === editing);
  const open = (threadId: ThreadId) =>
    navigation.dispatch(StackActions.push("Thread", { environmentId, threadId }));
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
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Duet"
        subtitle={actions.project?.title}
        onBack={() => navigation.goBack()}
        actions={[
          {
            icon: "gearshape",
            accessibilityLabel: "Duet settings",
            onPress: () => openSettings(navigation, "SettingsDuet"),
          },
        ]}
      />
      {!actions.settings.duetEnabled ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 p-5"
        >
          <Text className="text-base text-foreground-muted">
            Enable Duet in Settings to use it.
          </Text>
          <Button label="Duet settings" onPress={() => openSettings(navigation, "SettingsDuet")} />
        </ScrollView>
      ) : !actions.project ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 p-5"
        >
          <Text className="text-base text-foreground">Choose the project Duet focuses on.</Text>
          <DuetProjectPicker
            environmentId={environmentId}
            projectId={actions.settings.duetProjectId}
            disabled={!actions.canWrite}
            onChange={(duetProjectId) => void actions.save({ duetProjectId })}
          />
        </ScrollView>
      ) : (
        <>
          <LegendList
            data={rows}
            extraData={{
              entries: actions.settings.duetThreads,
              canEdit: actions.canWrite && canOperate,
              tab,
            }}
            renderScrollComponent={NativeScrollView}
            keyExtractor={(thread) => thread.id}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: Math.max(insets.bottom, 18) + 18,
            }}
            ListHeaderComponent={
              <View className="gap-3 py-3">
                <SegmentedControl
                  options={[
                    { value: "chat", label: "Chat" },
                    { value: "tasks", label: "Tasks" },
                  ]}
                  selected={tab}
                  onSelect={setTab}
                  role="tab"
                />
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
            ListEmptyComponent={
              <Text className="py-4 text-base text-foreground-muted">
                Create a thread to start chatting.
              </Text>
            }
            renderItem={({ item: thread }) => (
              <View className="flex-row items-center border-b border-border-subtle">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={thread.title}
                  onPress={() => open(thread.id)}
                  className="min-h-16 min-w-0 flex-1 flex-row items-center gap-3 py-3 active:opacity-70"
                >
                  <DuetIcon
                    icon={actions.settings.duetThreads[thread.id]?.icon ?? null}
                    color={duetIconColor(thread.id, actions.settings.duetThreads[thread.id]?.color)}
                  />
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-base text-foreground" numberOfLines={1}>
                      {thread.title}
                    </Text>
                    {tab === "tasks" ? (
                      <Text className="text-sm text-foreground-muted">{duetTaskLabel(thread)}</Text>
                    ) : null}
                  </View>
                  {!isDuetThreadPinned(actions.settings.duetThreads[thread.id]) ? (
                    <Text className="text-xs text-foreground-muted">Temporary</Text>
                  ) : null}
                </Pressable>
                <Button
                  label="Edit"
                  accessibilityLabel={`Edit ${thread.title}`}
                  tone="text"
                  size="compact"
                  disabled={!actions.canWrite || !canOperate}
                  onPress={() => setEditing(thread.id)}
                />
              </View>
            )}
          />
        </>
      )}
      {actions.settings.duetEnabled && edited ? (
        <DuetThreadEditor
          key={edited.id}
          environmentId={environmentId}
          thread={edited}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}
