import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import { useGT, useMessages } from "gt-react";
import { useNowSecond } from "../../hooks/useNowSecond";

export function ModelCooldownCountdown({ retryAt }: { retryAt: string }) {
  const remaining = Date.parse(retryAt) - useNowSecond();
  const gt = useGT();
  const messages = useMessages();
  return remaining > 0
    ? gt("Model cooldown: {duration}", {
        duration: formatDuration(Math.ceil(remaining / 1000) * 1000, messages),
      })
    : gt("Checking model availability");
}
