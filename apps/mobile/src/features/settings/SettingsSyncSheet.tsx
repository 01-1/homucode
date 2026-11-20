import { useGT } from "gt-react-native";
import type { ClientSettingsSyncChoice } from "@t3tools/client-runtime/state/client-settings-sync";
import {
  formatSyncedSettingValue,
  syncedSettingValuePreview,
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
  const gt = useGT();
  const navigation = useNavigation();
  const prompt = useSettingsSyncPrompt();
  const answered = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a dismissed sheet pauses sync the way "Decide later" does
  useEffect(() => {
    setSettingsSyncSheetOpen(true);
    return () => {
      if (!answered.current) deferSettingsSyncPrompt();
      setSettingsSyncSheetOpen(false);
    };
  }, []);

  const close = (action: () => void) => {
    answered.current = true;
    action();
    navigation.goBack();
  };

  return (
    <FitSheet
      header={<SheetHeader title={gt("Settings sync")} onClose={() => navigation.goBack()} />}
    >
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
  const gt = useGT();
  const { prompt } = props;
  const server =
    useEnvironmentPresentation(prompt.environmentId).presentation?.entry.target.label ??
    gt("your server");
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [choices, setChoices] = useState<Record<string, ClientSettingsSyncChoice>>(() =>
    Object.fromEntries(prompt.conflicts.map(({ key }) => [key, "remote" as const])),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const chooseAll = (choice: ClientSettingsSyncChoice) =>
    setChoices(Object.fromEntries(prompt.conflicts.map(({ key }) => [key, choice])));

  return (
    <>
      <SheetIntro
        title={
          prompt.firstSetup ? gt("Set up settings sync") : gt("Settings changed in two places")
        }
        description={
          prompt.firstSetup
            ? gt(
                "This phone's settings differ from the ones synced through {server}. Choose which value to keep for each.",
                { server },
              )
            : gt(
                "These settings changed on this phone and through {server} since they last synced. Choose which value to keep for each.",
                { server },
              )
        }
      />
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            label={gt("Use synced for all")}
            tone="secondary"
            size="compact"
            fullWidth
            onPress={() => chooseAll("remote")}
          />
        </View>
        <View className="flex-1">
          <Button
            label={gt("Keep this phone for all")}
            tone="secondary"
            size="compact"
            fullWidth
            onPress={() => chooseAll("local")}
          />
        </View>
      </View>
      {prompt.conflicts.map((conflict) => {
        const local = formatSyncedSettingValue(conflict.key, conflict.local);
        const remote = formatSyncedSettingValue(conflict.key, conflict.remote);
        const localPreview = syncedSettingValuePreview(local);
        const remotePreview = syncedSettingValuePreview(remote);
        const isLong = localPreview !== null || remotePreview !== null;
        const isExpanded = expanded.has(conflict.key);
        return (
          <SettingsSection key={conflict.key} title={syncedSettingLabel(conflict.key)}>
            <ListChoiceRow
              label={gt("This phone")}
              description={isExpanded ? local : (localPreview ?? local)}
              selected={choices[conflict.key] === "local"}
              onPress={() => setChoices((current) => ({ ...current, [conflict.key]: "local" }))}
            />
            <ListChoiceRow
              label={gt("Synced")}
              description={isExpanded ? remote : (remotePreview ?? remote)}
              selected={choices[conflict.key] !== "local"}
              separated
              onPress={() => setChoices((current) => ({ ...current, [conflict.key]: "remote" }))}
            />
            {isLong ? (
              <Button
                label={isExpanded ? gt("Show less") : gt("Read more")}
                tone="text"
                size="compact"
                fullWidth
                onPress={() => toggleExpanded(conflict.key)}
              />
            ) : null}
          </SettingsSection>
        );
      })}
      <View className="gap-2">
        <Button label={gt("Apply")} fullWidth onPress={() => props.onApply(choices)} />
        <Button
          label={gt("Decide later")}
          tone="secondary"
          fullWidth
          onPress={props.onDecideLater}
        />
        <Button
          label={gt("Turn off sync on this phone")}
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
