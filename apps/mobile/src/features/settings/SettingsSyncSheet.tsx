import type { ClientSettingsSyncChoice } from "@t3tools/client-runtime/state/client-settings-sync";
import {
  formatSyncedSettingValue,
  syncedSettingLabel,
} from "@t3tools/client-runtime/state/client-settings-sync";
import type { SettingsSyncPrompt } from "@t3tools/client-runtime/state/client-settings-sync-runner";
import { useNavigation } from "@react-navigation/native";
import { useAtomSet } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Button } from "../../components/ui/Button";
import { FitSheet } from "../../components/ui/FitSheet";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { SheetIntro } from "../../components/ui/SheetIntro";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentPresentation } from "../../state/presentation";
import { SettingsSection } from "./components/SettingsSection";
import {
  deferSettingsSyncPrompt,
  resolveSettingsSyncPrompt,
  setSettingsSyncSheetOpen,
  useSettingsSyncPrompt,
} from "./settingsSync";

export function SettingsSyncSheet() {
  const navigation = useNavigation();
  const prompt = useSettingsSyncPrompt();
  const answered = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a dismissed sheet pauses sync the way "Decide later" does
  useEffect(() => {
    setSettingsSyncSheetOpen(true);
    return () => {
      setSettingsSyncSheetOpen(false);
      if (!answered.current) deferSettingsSyncPrompt();
    };
  }, []);

  const close = (action: () => void) => {
    answered.current = true;
    action();
    navigation.goBack();
  };

  return (
    <FitSheet header={<SheetHeader title="Settings sync" onClose={() => navigation.goBack()} />}>
      {prompt ? (
        <SettingsSyncChoices
          key={[prompt.environmentId, ...prompt.conflicts.map(({ key }) => key)].join()}
          prompt={prompt}
          onApply={(choices) => close(() => resolveSettingsSyncPrompt(choices))}
          onDecideLater={() => close(deferSettingsSyncPrompt)}
        />
      ) : null}
    </FitSheet>
  );
}

function SettingsSyncChoices(props: {
  readonly prompt: SettingsSyncPrompt;
  readonly onApply: (choices: Readonly<Record<string, ClientSettingsSyncChoice>>) => void;
  readonly onDecideLater: () => void;
}) {
  const { prompt } = props;
  const server =
    useEnvironmentPresentation(prompt.environmentId).presentation?.entry.target.label ??
    "your server";
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [choices, setChoices] = useState<Record<string, ClientSettingsSyncChoice>>(() =>
    Object.fromEntries(prompt.conflicts.map(({ key }) => [key, "remote" as const])),
  );
  const chooseAll = (choice: ClientSettingsSyncChoice) =>
    setChoices(Object.fromEntries(prompt.conflicts.map(({ key }) => [key, choice])));

  return (
    <>
      <SheetIntro
        title={prompt.firstSetup ? "Set up settings sync" : "Settings changed in two places"}
        description={
          prompt.firstSetup
            ? `This phone's settings differ from the ones synced through ${server}. Choose which value to keep for each.`
            : `These settings changed on this phone and through ${server} since they last synced. Choose which value to keep for each.`
        }
      />
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            label="Use synced for all"
            tone="secondary"
            size="compact"
            fullWidth
            onPress={() => chooseAll("remote")}
          />
        </View>
        <View className="flex-1">
          <Button
            label="Keep this phone for all"
            tone="secondary"
            size="compact"
            fullWidth
            onPress={() => chooseAll("local")}
          />
        </View>
      </View>
      {prompt.conflicts.map((conflict) => (
        <SettingsSection key={conflict.key} title={syncedSettingLabel(conflict.key)}>
          <ListChoiceRow
            label={`This phone: ${formatSyncedSettingValue(conflict.local)}`}
            selected={choices[conflict.key] === "local"}
            onPress={() => setChoices((current) => ({ ...current, [conflict.key]: "local" }))}
          />
          <ListChoiceRow
            label={`Synced: ${formatSyncedSettingValue(conflict.remote)}`}
            selected={choices[conflict.key] !== "local"}
            separated
            onPress={() => setChoices((current) => ({ ...current, [conflict.key]: "remote" }))}
          />
        </SettingsSection>
      ))}
      <View className="gap-2">
        <Button label="Apply" fullWidth onPress={() => props.onApply(choices)} />
        <Button label="Decide later" tone="secondary" fullWidth onPress={props.onDecideLater} />
        <Button
          label="Turn off sync on this phone"
          tone="text"
          fullWidth
          onPress={() => {
            savePreferences({ settingsSyncEnabled: false });
            props.onDecideLater();
          }}
        />
      </View>
    </>
  );
}
