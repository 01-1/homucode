import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope, type ServerSettingsPatch } from "@t3tools/contracts";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import { useRef, useState } from "react";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import {
  mobilePreferencesAtom,
  mobileSettingsSyncEnabledAtom,
  updateMobilePreferencesAtom,
} from "../../state/preferences";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { MobileAgentMemorySettings } from "./MobileAgentMemorySettings";
import {
  MobileBuildVisibility,
  MobileExtraSettings,
  MobileThisDeviceName,
} from "./SetupBehaviorSettings";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import {
  managedSettingReason,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
} from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";

export function SettingsHomuCodeRouteScreen() {
  const menu = useSettingsEnvironmentMenu();
  const { selectedTargets, selectedProjectKey } = useSettingsEnvironmentFilter();
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const settingsSyncEnabled = useAtomValue(mobileSettingsSyncEnabledAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;

  return (
    <SettingsScreen title="HomuCode" menus={[menu]}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="This phone">
          <MobileThisDeviceName />
          <ListToggleRow
            label="Faster phone launch"
            description="Connect using the last signed-in account before sign-in loads. Applies next launch."
            value={
              AsyncResult.isSuccess(preferencesResult) &&
              preferencesResult.value.fasterPhoneLaunch === true
            }
            disabled={!preferencesReady}
            onValueChange={(fasterPhoneLaunch) => savePreferences({ fasterPhoneLaunch })}
          />
        </SettingsSection>
        <SettingsSection title="Settings sync">
          <ListToggleRow
            label="Sync settings"
            description="Keep theme, chat and other settings the same as your other devices, through connected servers."
            value={settingsSyncEnabled}
            disabled={!preferencesReady}
            onValueChange={(settingsSyncEnabled) => savePreferences({ settingsSyncEnabled })}
          />
        </SettingsSection>
        <SettingsSection title="MadoHomu">
          <SettingsRow
            icon="bubble.left.and.bubble.right"
            label="MadoHomu"
            target="SettingsMadoHomu"
            disabled={selectedTargets.length === 0}
          />
        </SettingsSection>
        <SettingsSection title="Building T3">
          {selectedTargets.map((target) => (
            <MobileBuildVisibility
              key={target.environmentId}
              environmentId={target.environmentId}
            />
          ))}
          {selectedTargets.some(
            (target) => target.serverConfig.settings.buildToolsSettingsVisible,
          ) ? (
            <SettingsRow icon="hammer" label="Building T3" target="SettingsBuildingT3" />
          ) : null}
        </SettingsSection>
        <HomuCodeServerSettings />
        {selectedProjectKey === null ? (
          <>
            {selectedTargets.map((target) => (
              <MobileExtraSettings
                key={target.environmentId}
                environmentId={target.environmentId}
                label={target.label}
              />
            ))}
            {selectedTargets
              .filter((target) => target.serverConfig.environment.platform.os === "linux")
              .map((target) => (
                <MobileAgentMemorySettings
                  key={target.environmentId}
                  environmentId={target.environmentId}
                  label={target.label}
                />
              ))}
          </>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function HomuCodeServerSettings() {
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const projectSelected = selectedProjectKey !== null;
  const targets = resolveMobileSettingsTargets(
    selectedTargets,
    projectSelected ? (selectedProject?.members.map((member) => member.project) ?? []) : null,
  );
  const autoreviewTargets = targets.filter((target) =>
    supportsSharedSettingsSync(target.environment),
  );
  const writable = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const writeSettings = useSettingsWriter();
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const canWrite =
    !projectSelected && targets.every((target) => writable.has(target.environment.environmentId));

  const write = (key: "statusLineEnabled" | "autoreviewEnabled", enabled: boolean) => {
    if (
      writing.current ||
      !canWrite ||
      targets.some(
        (target) => !readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const patch: ServerSettingsPatch = { [key]: enabled };
    writing.current = true;
    setPending(true);
    void writeSettings(targets, planMobileScopedSettingsPatch(targets, false, patch)).finally(
      () => {
        writing.current = false;
        setPending(false);
      },
    );
  };

  if (targets.length === 0) return null;
  return (
    <>
      <SettingsSection title="Status line">
        <SettingsSwitchRow
          icon="terminal"
          label="Status line"
          subtitle="Show the model, context, and usage limits under the composer. Set its command on desktop or web."
          value={uniformMobileSetting(targets, "statusLineEnabled")}
          disabled={
            !canWrite || pending || managedSettingReason(targets, "statusLineEnabled") !== undefined
          }
          onValueChange={(enabled) => write("statusLineEnabled", enabled)}
        />
      </SettingsSection>
      {!projectSelected && autoreviewTargets.length > 0 ? (
        <SettingsSection title="Autoreviewers">
          <SettingsSwitchRow
            icon="checkmark.circle"
            label="Autoreviewers (not recommended)"
            subtitle="Lets agents attach reviewer subagents. Findings can lag behind the thread. Turning this off pauses attached reviewers."
            value={uniformMobileSetting(autoreviewTargets, "autoreviewEnabled")}
            disabled={
              !canWrite ||
              pending ||
              managedSettingReason(targets, "autoreviewEnabled") !== undefined
            }
            onValueChange={(enabled) => write("autoreviewEnabled", enabled)}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
