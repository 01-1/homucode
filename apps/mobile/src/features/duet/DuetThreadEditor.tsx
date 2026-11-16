import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { DUET_ICON_COLORS, duetIconColor, isDuetThreadPinned } from "@t3tools/client-runtime/duet";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_DUET_ICON,
  DUET_THREAD_PROMPT_MAX_LENGTH,
  type EnvironmentId,
} from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DuetIcon, DUET_ICONS } from "./DuetIcon";
import { useDuetActions } from "./useDuetActions";

export function DuetThreadEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly onClose: () => void;
}) {
  const actions = useDuetActions(props.environmentId);
  const entry = actions.settings.duetThreads[props.thread.id];
  const [title, setTitle] = useState(props.thread.title);
  const [icon, setIcon] = useState(entry?.icon ?? "");
  const [color, setColor] = useState(duetIconColor(props.thread.id, entry?.color));
  const [prompt, setPrompt] = useState(entry?.prompt ?? "");
  const [pinned, setPinned] = useState(isDuetThreadPinned(entry));
  const [busy, setBusy] = useState(false);
  const update = useAtomCommand(threadEnvironment.updateMetadata);
  const validColor = /^#[0-9a-fA-F]{6}$/.test(color);
  const save = async () => {
    if (busy || !validColor || !title.trim()) return;
    setBusy(true);
    await (async () => {
      if (
        (
          await update({
            environmentId: props.environmentId,
            input: { threadId: props.thread.id, title: title.trim() },
          })
        )._tag !== "Success"
      )
        return;
      if (
        !(await actions.save({
          duetThreads: {
            [props.thread.id]: { icon: icon.trim() || null, color, prompt: prompt.trim(), pinned },
          },
        }))
      )
        return;
      props.onClose();
    })().finally(() => {
      setBusy(false);
    });
  };
  return (
    <Sheet title="Edit Duet thread" onClose={props.onClose} dismissDisabled={busy}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 p-5 pb-12"
      >
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">Title</Text>
          <TextInput
            accessibilityLabel="Thread title"
            value={title}
            onChangeText={setTitle}
            maxLength={500}
            readOnly={busy}
            className="min-h-12 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
        </View>
        <Text className="text-sm text-foreground-muted">Icon</Text>
        <View className="flex-row flex-wrap gap-2">
          {DUET_ICONS.map((choice) => (
            <Pressable
              key={choice.id}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              accessibilityState={{ selected: (icon || DEFAULT_DUET_ICON) === choice.id }}
              disabled={busy}
              onPress={() => setIcon(choice.id)}
              className={
                (icon || DEFAULT_DUET_ICON) === choice.id
                  ? "rounded-xl border border-primary p-2"
                  : "rounded-xl border border-border-subtle p-2"
              }
            >
              <DuetIcon
                icon={choice.id}
                color={validColor ? color : duetIconColor(props.thread.id)}
              />
            </Pressable>
          ))}
        </View>
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">Custom emoji</Text>
          <TextInput
            accessibilityLabel="Custom emoji"
            value={icon.startsWith("lucide:") ? "" : icon}
            onChangeText={setIcon}
            maxLength={16}
            readOnly={busy}
            className="min-h-12 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
        </View>
        <View className="flex-row flex-wrap gap-2">
          {DUET_ICON_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityRole="button"
              accessibilityLabel={`Icon color ${swatch}`}
              accessibilityState={{ selected: color.toLowerCase() === swatch }}
              disabled={busy}
              onPress={() => setColor(swatch)}
              className={
                color.toLowerCase() === swatch
                  ? "h-10 w-10 rounded-full border-2 border-foreground"
                  : "h-10 w-10 rounded-full"
              }
              style={{ backgroundColor: swatch }}
            />
          ))}
        </View>
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">Icon color (hex)</Text>
          <TextInput
            accessibilityLabel="Icon color (hex)"
            value={color}
            onChangeText={setColor}
            maxLength={7}
            autoCapitalize="none"
            autoCorrect={false}
            readOnly={busy}
            className="min-h-12 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
          {!validColor ? (
            <Text className="text-sm text-danger-foreground">Enter a color such as #3b82f6.</Text>
          ) : null}
        </View>
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">Thread prompt</Text>
          <TextInput
            accessibilityLabel="Thread prompt"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            maxLength={DUET_THREAD_PROMPT_MAX_LENGTH}
            readOnly={busy}
            className="min-h-24 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
          <Text className="text-sm text-foreground-muted">
            Included privately with the title on every turn.
          </Text>
        </View>
        <SettingsSwitchRow
          label="Keep this thread pinned"
          value={pinned}
          onValueChange={setPinned}
          disabled={busy}
        />
        <Button
          label="Save"
          tone="primary"
          fullWidth
          loading={busy}
          disabled={!validColor || !title.trim() || !actions.canWrite}
          onPress={() => void save()}
        />
        <Button label="Cancel" tone="text" fullWidth disabled={busy} onPress={props.onClose} />
      </ScrollView>
    </Sheet>
  );
}
