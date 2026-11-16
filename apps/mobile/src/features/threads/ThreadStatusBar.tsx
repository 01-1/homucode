import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type AnsiSegment,
  buildStatusLineInput,
  parseAnsiLines,
  stampStatusLineInput,
  type StatusLineInputSource,
} from "@t3tools/client-runtime/status-line";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useContext, useEffect, useState } from "react";
import { AppState, type TextStyle } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { serverEnvironment } from "../../state/server";
import { useNowMinuteMs } from "../../lib/clock";

// Claude Code redraws on events; the timer keeps clocks and countdowns current while idle.
const REFRESH_MS = 30_000;
const DEBOUNCE_MS = 300;

// The scripts pick colors for dark terminals, so light themes darken them to stay readable.
function darken(color: string): string {
  const value = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * 0.6);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function segmentStyle(segment: AnsiSegment, dark: boolean): TextStyle {
  return {
    ...(segment.color === null ? {} : { color: dark ? segment.color : darken(segment.color) }),
    ...(segment.background === null ? {} : { backgroundColor: segment.background }),
    ...(segment.bold ? { fontWeight: "600" } : {}),
    ...(segment.dim ? { opacity: 0.6 } : {}),
    ...(segment.italic ? { fontStyle: "italic" } : {}),
    ...(segment.underline ? { textDecorationLine: "underline" } : {}),
  };
}

/** A Claude Code style status line: the environment's command draws it from the thread's state. */
export function ThreadStatusBar(props: {
  readonly environmentId: EnvironmentId;
  readonly createdAt: string | null;
  readonly source: Omit<StatusLineInputSource, "nowMs">;
}) {
  const { environmentId, createdAt } = props;
  const { themeAppearance } = useAppearancePreferences();
  const enabled = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) =>
      config?.environment.capabilities.statusLine === true &&
      config.settings.statusLineEnabled !== false,
  );
  const registry = useContext(RegistryContext);
  // Limits are read on the minute so the key, and with it the command, only changes on new data.
  const minute = useNowMinuteMs();
  const inputKey = JSON.stringify(buildStatusLineInput({ ...props.source, nowMs: minute }));
  const sessionKey = `${environmentId}:${props.source.threadId}`;
  const [result, setResult] = useState<{
    readonly sessionKey: string;
    readonly text: string;
    readonly error: string | null;
  } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the server's status line command
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const draw = async () => {
      if (AppState.currentState !== "active") return;
      const input = stampStatusLineInput(JSON.parse(inputKey), createdAt, Date.now());
      const response = await runAtomCommand(
        registry,
        serverEnvironment.renderStatusLine,
        { environmentId, input: { input } },
        { reportFailure: false },
      );
      if (cancelled || response._tag !== "Success") return;
      setResult({
        sessionKey,
        text: response.value.text,
        error: response.value.error ?? null,
      });
    };
    const debounce = setTimeout(() => void draw(), DEBOUNCE_MS);
    const interval = setInterval(() => void draw(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [enabled, inputKey, createdAt, environmentId, sessionKey, registry]);

  if (!enabled || result === null || result.sessionKey !== sessionKey) return null;
  const lines = parseAnsiLines(result.text);
  if (lines.length === 0) {
    if (result.error === null) return null;
    return (
      <Text numberOfLines={1} className="pt-1.5 font-mono text-2xs text-foreground-muted">
        Status line failed: {result.error}
      </Text>
    );
  }
  const dark = themeAppearance === "dark";
  return lines.map((line, lineIndex) => (
    <Text
      // oxlint-disable-next-line react/no-array-index-key -- lines have no identity beyond order
      key={lineIndex}
      numberOfLines={1}
      className={`${lineIndex === 0 ? "pt-1.5 " : ""}font-mono text-2xs leading-4 text-foreground`}
    >
      {line.map((segment, segmentIndex) => (
        <Text
          // oxlint-disable-next-line react/no-array-index-key -- segments have no identity beyond order
          key={segmentIndex}
          style={segmentStyle(segment, dark)}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  ));
}
