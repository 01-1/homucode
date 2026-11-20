import { T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import {
  isMadoHomuThreadPinned,
  MADOHOMU_ICON_COLORS,
  madohomuIconColor,
} from "@t3tools/client-runtime/madohomu";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_MADOHOMU_ICON,
  MADOHOMU_THREAD_PROMPT_MAX_LENGTH,
  type EnvironmentId,
} from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { MadoHomuIcon, MADOHOMU_ICONS } from "./MadoHomuIcon";
import { useMadoHomuActions } from "./useMadoHomuActions";

export type MadoHomuEditableThread = Pick<EnvironmentThreadShell, "id" | "title">;

export function MadoHomuThreadEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: MadoHomuEditableThread;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const actions = useMadoHomuActions(props.environmentId);
  const entry = actions.settings.madohomuThreads[props.thread.id];
  const [title, setTitle] = useState(props.thread.title);
  const [icon, setIcon] = useState(entry?.icon ?? "");
  const [color, setColor] = useState(madohomuIconColor(props.thread.id, entry?.color));
  const [prompt, setPrompt] = useState(entry?.prompt ?? "");
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
          madohomuThreads: {
            [props.thread.id]: {
              ...entry,
              pinned: isMadoHomuThreadPinned(entry),
              icon: icon.trim() || null,
              color,
              prompt: prompt.trim(),
            },
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
    <Sheet title={gt("Edit MadoHomu thread")} onClose={props.onClose} dismissDisabled={busy}>
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 p-5 pb-12"
      >
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            <T>Title</T>
          </Text>
          <TextInput
            accessibilityLabel={gt("Thread title")}
            value={title}
            onChangeText={setTitle}
            maxLength={500}
            readOnly={busy}
            className="min-h-12 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
        </View>
        <Text className="text-sm text-foreground-muted">
          <T>Icon</T>
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {MADOHOMU_ICONS.map((choice) => (
            <Pressable
              key={choice.id}
              accessibilityRole="button"
              accessibilityLabel={resolve(choice.label)}
              accessibilityState={{ selected: (icon || DEFAULT_MADOHOMU_ICON) === choice.id }}
              disabled={busy}
              onPress={() => setIcon(choice.id)}
              className={
                (icon || DEFAULT_MADOHOMU_ICON) === choice.id
                  ? "rounded-xl border border-primary p-2"
                  : "rounded-xl border border-border-subtle p-2"
              }
            >
              <MadoHomuIcon
                icon={choice.id}
                color={validColor ? color : madohomuIconColor(props.thread.id)}
              />
            </Pressable>
          ))}
        </View>
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            <T>Custom emoji</T>
          </Text>
          <TextInput
            accessibilityLabel={gt("Custom emoji")}
            value={icon.startsWith("lucide:") ? "" : icon}
            onChangeText={setIcon}
            maxLength={16}
            readOnly={busy}
            className="min-h-12 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
        </View>
        <View className="flex-row flex-wrap gap-2">
          {MADOHOMU_ICON_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityRole="button"
              accessibilityLabel={gt("Icon color {swatch}", { swatch })}
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
          <Text className="text-sm text-foreground-muted">
            <T>Icon color (hex)</T>
          </Text>
          <TextInput
            accessibilityLabel={gt("Icon color (hex)")}
            value={color}
            onChangeText={setColor}
            maxLength={7}
            autoCapitalize="none"
            autoCorrect={false}
            readOnly={busy}
            className="min-h-12 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
          {!validColor ? (
            <Text className="text-sm text-danger-foreground">
              <T>Enter a color such as #3b82f6.</T>
            </Text>
          ) : null}
        </View>
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            <T>Thread prompt</T>
          </Text>
          <TextInput
            accessibilityLabel={gt("Thread prompt")}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            maxLength={MADOHOMU_THREAD_PROMPT_MAX_LENGTH}
            readOnly={busy}
            className="min-h-24 rounded-xl bg-grouped-card p-3 text-base text-foreground"
          />
          <Text className="text-sm text-foreground-muted">
            <T>Included privately with the title on every turn.</T>
          </Text>
        </View>
        <Button
          label={gt("Save")}
          tone="primary"
          fullWidth
          loading={busy}
          disabled={!validColor || !title.trim() || !actions.canWrite}
          onPress={() => void save()}
        />
        <Button
          label={gt("Cancel")}
          tone="text"
          fullWidth
          disabled={busy}
          onPress={props.onClose}
        />
      </ScrollView>
    </Sheet>
  );
}
