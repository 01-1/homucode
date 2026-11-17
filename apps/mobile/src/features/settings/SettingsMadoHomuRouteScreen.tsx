import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { MadoHomuProjectPicker } from "../madohomu/MadoHomuProjectPicker";
import { useMadoHomuActions } from "../madohomu/useMadoHomuActions";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

export function SettingsMadoHomuRouteScreen() {
  const menu = useSettingsEnvironmentMenu();
  const { selectedTargets, selectedProjectKey } = useSettingsEnvironmentFilter();
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="MadoHomu" menus={[menu]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {selectedProjectKey !== null ? (
          <Text className="text-base text-foreground-muted">
            Choose an environment in the filter to configure MadoHomu.
          </Text>
        ) : selectedTargets.length === 0 ? (
          <Text className="text-base text-foreground-muted">
            Connect to an environment to configure MadoHomu.
          </Text>
        ) : (
          selectedTargets.map((target) => (
            <EnvironmentMadoHomuSettings
              key={target.environmentId}
              environmentId={target.environmentId}
              label={target.label}
            />
          ))
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function EnvironmentMadoHomuSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const actions = useMadoHomuActions(props.environmentId);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const savedTime =
    actions.task?.schedule.type === "fixed_time" ? actions.task.schedule.timeOfDay : "09:00";
  const briefEnabled =
    actions.task?.enabled === true && actions.task.projectId === actions.settings.madohomuProjectId;
  const validTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(time ?? savedTime);
  const canBrief =
    actions.canWrite &&
    actions.canSchedule &&
    actions.canCreate &&
    actions.project !== null &&
    actions.modelSelection !== null &&
    actions.taskQuery.isSuccess;
  const run = async (action: () => Promise<boolean>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    await (async () => {
      await action();
    })().finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  return (
    <SettingsSection title={props.label}>
      <SettingsSwitchRow
        label="Enable MadoHomu"
        subtitle="A focused Chat and Tasks view for one project. Every MadoHomu thread starts pinned."
        value={actions.settings.madohomuEnabled}
        disabled={busy || !actions.canWrite}
        onValueChange={(madohomuEnabled) => void run(() => actions.save({ madohomuEnabled }))}
      />
      {actions.settings.madohomuEnabled ? (
        <>
          <Text className="px-4 pt-3 text-sm text-foreground-muted">MadoHomu project</Text>
          <MadoHomuProjectPicker
            environmentId={props.environmentId}
            projectId={actions.settings.madohomuProjectId}
            disabled={busy || !actions.canWrite}
            onChange={(madohomuProjectId) => void run(() => actions.save({ madohomuProjectId }))}
          />
          <SettingsSwitchRow
            label="Morning brief"
            subtitle="A daily summary and proposed next steps. The agent plans and asks for approval before acting."
            value={briefEnabled}
            disabled={
              busy ||
              !actions.canWrite ||
              !actions.canSchedule ||
              !actions.taskQuery.isSuccess ||
              (!briefEnabled && (!canBrief || !validTime))
            }
            onValueChange={(enabled) =>
              void run(() => actions.setMorningBrief(enabled, time ?? savedTime))
            }
          />
          <View className="gap-3 px-4 py-3">
            <Text className="text-sm text-foreground-muted">Daily time (HH:MM)</Text>
            <TextInput
              accessibilityLabel="Morning brief time"
              value={time ?? savedTime}
              onChangeText={setTime}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={5}
              readOnly={busy || !actions.canSchedule}
              className="min-h-12 rounded-xl bg-subtle p-3 text-base text-foreground"
            />
            {!validTime ? (
              <Text className="text-sm text-danger-foreground">Enter a time such as 09:00.</Text>
            ) : null}
            <Text className="text-sm text-foreground-muted">
              Time zone: {actions.taskQuery.data?.timeZone ?? "Server time"}
            </Text>
            {briefEnabled && time !== null && time !== savedTime ? (
              <Button
                label="Save time"
                disabled={busy || !canBrief || !validTime}
                onPress={() => void run(() => actions.setMorningBrief(true, time))}
              />
            ) : null}
            {actions.taskQuery.error ? (
              <Text className="text-sm text-danger-foreground">{actions.taskQuery.error}</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </SettingsSection>
  );
}
