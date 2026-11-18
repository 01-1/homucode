import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import {
  mobilePreferencesAtom,
  mobileSettingsSyncEnabledAtom,
  updateMobilePreferencesAtom,
} from "../../state/preferences";
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
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

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
        {selectedProjectKey === null ? (
          <>
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
