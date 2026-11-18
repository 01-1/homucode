import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { MADOHOMU_SCRATCH_LABEL } from "@t3tools/client-runtime/madohomu";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
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
  { value: "hidden", label: "None", description: "T3 Code lists none of them." },
  {
    value: "scratch",
    label: `${MADOHOMU_SCRATCH_LABEL} only`,
    description: "T3 Code lists the threads not pinned in MadoHomu.",
  },
  { value: "all", label: "All", description: "T3 Code lists every thread of the project." },
];

const WORKING_PLACEMENT_OPTIONS: ReadonlyArray<{
  readonly value: ServerSettings["madohomuWorkingPlacement"];
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "section",
    label: "Working section",
    description: `Working ${MADOHOMU_SCRATCH_LABEL} threads move to their own section.`,
  },
  {
    value: "top",
    label: `Top of ${MADOHOMU_SCRATCH_LABEL}`,
    description: `Working threads sort first in ${MADOHOMU_SCRATCH_LABEL}.`,
  },
  { value: "none", label: "Leave in place", description: "Working threads keep their place." },
];

export function SettingsMadoHomuRouteScreen() {
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
        {selectedProjectKey !== null ? (
          <Text className="text-base text-foreground-muted">
            Choose an environment in the filter to configure MadoHomu.
          </Text>
        ) : settingsTargets.length === 0 ? (
          <Text className="text-base text-foreground-muted">
            Connect to an environment to configure MadoHomu.
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
        label="Enable MadoHomu"
        subtitle="A focused view for one project, with your threads in sections. Every MadoHomu thread starts pinned."
        value={actions.settings.madohomuEnabled}
        disabled={busy || projectSelection.isSelecting || !actions.canWrite}
        onValueChange={(madohomuEnabled) => void run(() => actions.save({ madohomuEnabled }))}
      />
      <Text className="px-4 pt-3 text-sm text-foreground-muted">MadoHomu project</Text>
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
            Show MadoHomu threads in T3 Code
          </Text>
          {CODE_VISIBILITY_OPTIONS.map((option, index) => (
            <ListChoiceRow
              key={option.value}
              label={option.label}
              description={option.description}
              selected={actions.settings.madohomuCodeVisibility === option.value}
              separated={index > 0}
              disabled={busy || !actions.canWrite}
              onPress={() => void run(() => actions.save({ madohomuCodeVisibility: option.value }))}
            />
          ))}
          <Text className="px-4 pt-3 text-sm text-foreground-muted">Working threads</Text>
          {WORKING_PLACEMENT_OPTIONS.map((option, index) => (
            <ListChoiceRow
              key={option.value}
              label={option.label}
              description={option.description}
              selected={actions.settings.madohomuWorkingPlacement === option.value}
              separated={index > 0}
              disabled={busy || !actions.canWrite}
              onPress={() =>
                void run(() => actions.save({ madohomuWorkingPlacement: option.value }))
              }
            />
          ))}
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
