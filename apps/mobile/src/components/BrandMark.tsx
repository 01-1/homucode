import Constants from "expo-constants";
import { msg, T, useMessages } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "./ui/AppText";

const appVariant = Constants.expoConfig?.extra?.appVariant;
const DEFAULT_STAGE_LABEL =
  appVariant === "development"
    ? msg("Dev", { $context: "app release stage badge" })
    : appVariant === "preview"
      ? msg("Preview", { $context: "app release stage badge" })
      : msg("Beta", { $context: "app release stage badge" });

const HOMUCODE_WORDMARK = { prefix: "Homu", suffix: "Code" };

export function BrandMark(props: { readonly compact?: boolean; readonly stageLabel?: string }) {
  const m = useMessages();
  const compact = props.compact ?? false;
  const stageLabel = props.stageLabel ?? m(DEFAULT_STAGE_LABEL);

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <Text className="text-lg font-t3-bold tracking-[-0.4px] text-foreground-muted">
          <Text className="font-t3-bold text-foreground">{HOMUCODE_WORDMARK.prefix}</Text>
          {HOMUCODE_WORDMARK.suffix}
        </Text>
        <View className="rounded-full bg-subtle px-2 py-1">
          <Text className="text-3xs font-t3-bold tracking-[1.1px] uppercase text-foreground-muted">
            {stageLabel}
          </Text>
        </View>
      </View>
      {!compact ? (
        <Text className="text-xs font-medium text-foreground-muted">
          <T>Mobile control surface for your live coding environments</T>
        </Text>
      ) : null}
    </View>
  );
}
