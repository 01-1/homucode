import { T, msg, useGT, useMessages } from "gt-react-native";
import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform, TextInput, View } from "react-native";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { MadoHomuProjectPicker } from "../madohomu/MadoHomuProjectPicker";
import { useMadoHomuActions } from "../madohomu/useMadoHomuActions";
import {
  useMadoHomuDestination,
  useMadoHomuProjectSelection,
} from "../madohomu/useMadoHomuDestination";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

const CODE_VISIBILITY_OPTIONS: ReadonlyArray<{
  readonly value: ServerSettings["madohomuCodeVisibility"];
  readonly label: string;
  readonly description: string;
}> = [
  { value: "hidden", label: msg("None"), description: msg("HomuCode lists none of them.") },
  {
    value: "scratch",
    label: msg("{scratch} only"),
    description: msg("HomuCode lists the threads not pinned in MadoHomu."),
  },
  {
    value: "all",
    label: msg("All"),
    description: msg("HomuCode lists every thread of the project."),
  },
];

const WORKING_PLACEMENT_OPTIONS: ReadonlyArray<{
  readonly value: ServerSettings["madohomuWorkingPlacement"];
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "section",
    label: msg("Working section"),
    description: msg("Working {scratch} threads move to their own section."),
  },
  {
    value: "top",
    label: msg("Top of {scratch}"),
    description: msg("Working threads sort first in {scratch}."),
  },
  {
    value: "none",
    label: msg("Leave in place"),
    description: msg("Working threads keep their place."),
  },
];

export function SettingsMadoHomuRouteScreen() {
  const gt = useGT();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const menu = useSettingsEnvironmentMenu();
  const { selectedTargets, selectedIds, selectedProjectKey, selectAll } =
    useSettingsEnvironmentFilter();
  const { destination } = useMadoHomuDestination();
  const selectedDestination =
    selectedIds === null
      ? selectedTargets.find((target) => target.environmentId === destination.environmentId)
      : undefined;
  const settingsTargets = selectedDestination ? [selectedDestination] : selectedTargets;
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="MadoHomu" menus={[menu]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {Platform.OS === "android" ? (
          <SettingsSection title={gt("This phone")}>
            <SettingsSwitchRow
              label={gt("Show MadoHomu in the home thread list")}
              subtitle={gt("Add a MadoHomu row when the navigation rail is hidden.")}
              value={
                AsyncResult.isSuccess(preferences) &&
                preferences.value.showAndroidMadoHomuHomeRow === true
              }
              disabled={!AsyncResult.isSuccess(preferences) || preferences.waiting}
              onValueChange={(showAndroidMadoHomuHomeRow) =>
                savePreferences({ showAndroidMadoHomuHomeRow })
              }
            />
          </SettingsSection>
        ) : null}
        {selectedProjectKey !== null ? (
          <Text className="text-base text-foreground-muted">
            <T>Choose an environment in the filter to configure MadoHomu.</T>
          </Text>
        ) : settingsTargets.length === 0 ? (
          <Text className="text-base text-foreground-muted">
            <T>Connect to an environment to configure MadoHomu.</T>
          </Text>
        ) : (
          settingsTargets.map((target) => (
            <EnvironmentMadoHomuSettings
              key={target.environmentId}
              environmentId={target.environmentId}
              label={target.label}
              onSwitchEnvironment={selectAll}
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
  readonly onSwitchEnvironment: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const scratch = resolve(msg("Scratch", { $context: "MadoHomu thread section" }));
  const actions = useMadoHomuActions(props.environmentId);
  const projectSelection = useMadoHomuProjectSelection();
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
        label={gt("Enable MadoHomu")}
        subtitle={
          Platform.OS === "android"
            ? gt(
                "A focused view for one project. Enabling it adds a separate MadoHomu icon to your app launcher.",
              )
            : gt(
                "A focused view for one project, with your threads in sections. Every MadoHomu thread starts pinned.",
              )
        }
        value={actions.settings.madohomuEnabled}
        disabled={busy || projectSelection.isSelecting || !actions.canWrite}
        onValueChange={(madohomuEnabled) => void run(() => actions.save({ madohomuEnabled }))}
      />
      <Text className="px-4 pt-3 text-sm text-foreground-muted">
        <T>MadoHomu project</T>
      </Text>
      <MadoHomuProjectPicker
        environmentId={props.environmentId}
        projectId={actions.settings.madohomuProjectId}
        environments={projectSelection.linked}
        selectionIssue={projectSelection.selectionIssue}
        disabled={busy || projectSelection.isSelecting}
        canClear={actions.canWrite}
        onChange={(project) =>
          void run(async () => {
            if (!project) return actions.save({ madohomuProjectId: null });
            const saved = await projectSelection.changeProject(project);
            if (saved && project.environmentId !== props.environmentId) {
              props.onSwitchEnvironment();
            }
            return saved;
          })
        }
      />
      {actions.settings.madohomuEnabled ? (
        <>
          <Text className="px-4 pt-3 text-sm text-foreground-muted">
            <T>Show MadoHomu threads in HomuCode</T>
          </Text>
          {CODE_VISIBILITY_OPTIONS.map((option, index) => (
            <ListChoiceRow
              key={option.value}
              label={resolve(option.label, { scratch })}
              description={resolve(option.description, { scratch })}
              selected={actions.settings.madohomuCodeVisibility === option.value}
              separated={index > 0}
              disabled={busy || !actions.canWrite}
              onPress={() => void run(() => actions.save({ madohomuCodeVisibility: option.value }))}
            />
          ))}
          <Text className="px-4 pt-3 text-sm text-foreground-muted">
            <T>Working threads</T>
          </Text>
          {WORKING_PLACEMENT_OPTIONS.map((option, index) => (
            <ListChoiceRow
              key={option.value}
              label={resolve(option.label, { scratch })}
              description={resolve(option.description, { scratch })}
              selected={actions.settings.madohomuWorkingPlacement === option.value}
              separated={index > 0}
              disabled={busy || !actions.canWrite}
              onPress={() =>
                void run(() => actions.save({ madohomuWorkingPlacement: option.value }))
              }
            />
          ))}
          <SettingsSwitchRow
            label={gt("Morning brief")}
            subtitle={gt(
              "A daily summary and proposed next steps. The agent plans and asks for approval before acting.",
            )}
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
            <Text className="text-sm text-foreground-muted">
              <T>Daily time (HH:MM)</T>
            </Text>
            <TextInput
              accessibilityLabel={gt("Morning brief time")}
              value={time ?? savedTime}
              onChangeText={setTime}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={5}
              readOnly={busy || !actions.canSchedule}
              className="min-h-12 rounded-xl bg-subtle p-3 text-base text-foreground"
            />
            {!validTime ? (
              <Text className="text-sm text-danger-foreground">
                <T>Enter a time such as 09:00.</T>
              </Text>
            ) : null}
            <Text className="text-sm text-foreground-muted">
              {gt("Time zone: {timeZone}", {
                timeZone: actions.taskQuery.data?.timeZone ?? gt("Server time"),
              })}
            </Text>
            {briefEnabled && time !== null && time !== savedTime ? (
              <Button
                label={gt("Save time")}
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
