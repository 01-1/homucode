import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { LegendList } from "@legendapp/list/react-native";
import {
  madohomuIconColor,
  madohomuTaskLabel,
  isMadoHomuThreadPinned,
  orderMadoHomuTasks,
  orderMadoHomuThreads,
} from "@t3tools/client-runtime/madohomu";
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
import { MadoHomuIcon } from "./MadoHomuIcon";
import { MadoHomuProjectPicker } from "./MadoHomuProjectPicker";
import { MadoHomuThreadEditor } from "./MadoHomuThreadEditor";
import { useMadoHomuActions } from "./useMadoHomuActions";

export function MadoHomuRouteScreen(props: StaticScreenProps<{ readonly environmentId: string }>) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  return <MadoHomuWorkspace key={environmentId} environmentId={environmentId} />;
}

function MadoHomuWorkspace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
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
      ? orderMadoHomuTasks(threads)
      : orderMadoHomuThreads(threads, actions.settings.madohomuThreads);
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
        title="MadoHomu"
        subtitle={actions.project?.title}
        onBack={() => navigation.goBack()}
        actions={[
          {
            icon: "gearshape",
            accessibilityLabel: "MadoHomu settings",
            onPress: () => openSettings(navigation, "SettingsMadoHomu"),
          },
        ]}
      />
      {!actions.settings.madohomuEnabled ? (
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
            projectId={actions.settings.madohomuProjectId}
            disabled={!actions.canWrite}
            onChange={(madohomuProjectId) => void actions.save({ madohomuProjectId })}
          />
        </ScrollView>
      ) : (
        <>
          <LegendList
            data={rows}
            extraData={{
              entries: actions.settings.madohomuThreads,
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
                  <MadoHomuIcon
                    icon={actions.settings.madohomuThreads[thread.id]?.icon ?? null}
                    color={madohomuIconColor(
                      thread.id,
                      actions.settings.madohomuThreads[thread.id]?.color,
                    )}
                  />
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-base text-foreground" numberOfLines={1}>
                      {thread.title}
                    </Text>
                    {tab === "tasks" ? (
                      <Text className="text-sm text-foreground-muted">
                        {madohomuTaskLabel(thread)}
                      </Text>
                    ) : null}
                  </View>
                  {!isMadoHomuThreadPinned(actions.settings.madohomuThreads[thread.id]) ? (
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
      {actions.settings.madohomuEnabled && edited ? (
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
