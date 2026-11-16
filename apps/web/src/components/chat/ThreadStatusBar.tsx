import type { EnvironmentId } from "@t3tools/contracts";
import {
  type AnsiSegment,
  buildStatusLineInput,
  parseAnsiLines,
  stampStatusLineInput,
  type StatusLineInputSource,
} from "@t3tools/client-runtime/status-line";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { type CSSProperties, useContext, useEffect, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { serverEnvironment } from "../../state/server";

// Claude Code redraws on events; the timer keeps clocks and countdowns current while idle.
const REFRESH_MS = 30_000;
const DEBOUNCE_MS = 300;

function segmentStyle(segment: AnsiSegment): CSSProperties | undefined {
  if (
    segment.color === null &&
    segment.background === null &&
    !segment.bold &&
    !segment.dim &&
    !segment.italic &&
    !segment.underline
  ) {
    return undefined;
  }
  return {
    // Scripts pick colors for dark terminals; leaning toward the foreground keeps them readable on light themes.
    ...(segment.color === null
      ? {}
      : { color: `color-mix(in oklab, ${segment.color} 70%, var(--foreground))` }),
    ...(segment.background === null ? {} : { backgroundColor: segment.background }),
    ...(segment.bold ? { fontWeight: 600 } : {}),
    ...(segment.dim ? { opacity: 0.6 } : {}),
    ...(segment.italic ? { fontStyle: "italic" } : {}),
    ...(segment.underline ? { textDecoration: "underline" } : {}),
  };
}

/** A Claude Code style status line: the environment's command draws it from the thread's state. */
export function ThreadStatusBar(props: {
  readonly environmentId: EnvironmentId;
  readonly createdAt: string | null;
  readonly source: Omit<StatusLineInputSource, "nowMs">;
}) {
  const { environmentId, createdAt } = props;
  const enabled = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) =>
      config?.environment.capabilities.statusLine === true &&
      config.settings.statusLineEnabled !== false,
  );
  const registry = useContext(RegistryContext);
  // Limits are read on the minute so the key, and with it the command, only changes on new data.
  const nowMinute = useNowMinute();
  const inputKey = JSON.stringify(
    buildStatusLineInput({ ...props.source, nowMs: Date.parse(`${nowMinute}:00Z`) }),
  );
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
      if (document.visibilityState === "hidden") return;
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
    const debounce = window.setTimeout(() => void draw(), DEBOUNCE_MS);
    const interval = window.setInterval(() => void draw(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      window.clearInterval(interval);
    };
  }, [enabled, inputKey, createdAt, environmentId, sessionKey, registry]);

  if (!enabled || result === null || result.sessionKey !== sessionKey) return null;
  const lines = parseAnsiLines(result.text);
  if (lines.length === 0) {
    if (result.error === null) return null;
    return (
      <div
        data-chat-status-line="error"
        className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) truncate px-1 pt-1.5 font-mono text-muted-foreground text-xs"
      >
        Status line failed: {result.error}
      </div>
    );
  }
  return (
    <div
      data-chat-status-line="true"
      className="mx-auto flex w-full min-w-0 max-w-(--chat-content-max-width) flex-col px-1 pt-1.5 font-mono text-2xs text-foreground leading-4"
    >
      {lines.map((line, lineIndex) => (
        // oxlint-disable-next-line react/no-array-index-key -- lines have no identity beyond order
        <div key={lineIndex} className="min-w-0 truncate whitespace-pre">
          {line.map((segment, segmentIndex) => (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- segments have no identity beyond order
              key={segmentIndex}
              style={segmentStyle(segment)}
            >
              {segment.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
