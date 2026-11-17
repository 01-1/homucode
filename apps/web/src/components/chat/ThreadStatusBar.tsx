import type { EnvironmentId } from "@t3tools/contracts";
import {
  type AnsiSegment,
  buildStatusLineInput,
  parseAnsiLines,
  splitStatusLineClock,
  splitStatusLineDirectory,
  stampStatusLineInput,
  type StatusLineColorRole,
  statusLineColorRole,
  type StatusLineInputSource,
} from "@t3tools/client-runtime/status-line";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { serverEnvironment } from "../../state/server";

// Claude Code redraws on events; the timer keeps clocks and countdowns current while idle.
const REFRESH_MS = 30_000;
const DEBOUNCE_MS = 300;

type StatusLineResult = {
  readonly lines: ReadonlyArray<ReadonlyArray<AnsiSegment>>;
  readonly error: string | null;
};

// One runner per thread feeds both the composer line and the top bar, so the command runs once.
const results = new Map<string, StatusLineResult>();
const listeners = new Set<() => void>();
function publish(sessionKey: string, result: StatusLineResult | null) {
  if (result === null) {
    if (!results.delete(sessionKey)) return;
  } else {
    results.set(sessionKey, result);
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function useStatusLineResult(sessionKey: string): StatusLineResult | null {
  return useSyncExternalStore(subscribe, () => results.get(sessionKey) ?? null);
}

export function threadStatusLineKey(environmentId: EnvironmentId, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

// Scripts pick terminal colors; each takes the theme color with the same meaning.
const ROLE_COLORS: Record<StatusLineColorRole, string | null> = {
  foreground: null,
  muted: "var(--muted-foreground)",
  error: "var(--error-foreground)",
  warning: "var(--warning-foreground)",
  success: "var(--success-foreground)",
  info: "var(--info-foreground)",
  accent: "var(--ring)",
};

function themedBackground(color: string): string {
  const role = ROLE_COLORS[statusLineColorRole(color)];
  return role === null ? "var(--muted)" : `color-mix(in srgb, ${role} 18%, transparent)`;
}

function segmentColor(segment: AnsiSegment): string | null {
  return segment.color === null ? null : ROLE_COLORS[statusLineColorRole(segment.color)];
}

function segmentStyle(segment: AnsiSegment): CSSProperties | undefined {
  const color = segmentColor(segment);
  if (
    color === null &&
    segment.background === null &&
    !segment.bold &&
    !segment.dim &&
    !segment.italic &&
    !segment.underline
  ) {
    return undefined;
  }
  return {
    ...(color === null ? {} : { color }),
    ...(segment.background === null
      ? {}
      : { backgroundColor: themedBackground(segment.background) }),
    ...(segment.bold ? { fontWeight: 600 } : {}),
    ...(segment.dim ? { opacity: 0.6 } : {}),
    ...(segment.italic ? { fontStyle: "italic" } : {}),
    ...(segment.underline ? { textDecoration: "underline" } : {}),
  };
}

const PERCENT_PATTERN = /(\d+(?:\.\d+)?)%/g;

/** A percentage as a bar: its label sits beside the bar, or inside it when the line is short of room. */
function PercentBar(props: { readonly value: string; readonly color: string | null }) {
  const fill = props.color ?? "var(--foreground)";
  return (
    <span
      className="relative inline-flex h-3 w-6 overflow-hidden rounded-xs align-[-2px] group-data-[bars=inside]/status-line:w-9"
      style={{ backgroundColor: `color-mix(in srgb, ${fill} 15%, transparent)` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0"
        style={{
          width: `${Math.min(100, Number(props.value))}%`,
          backgroundColor: `color-mix(in srgb, ${fill} 40%, transparent)`,
        }}
      />
      <span className="relative hidden w-full text-center leading-3 group-data-[bars=inside]/status-line:block">
        {props.value}%
      </span>
    </span>
  );
}

function SegmentText(props: { readonly text: string; readonly color: string | null }) {
  const parts = props.text.split(PERCENT_PATTERN);
  if (parts.length === 1) return props.text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      // oxlint-disable-next-line react/no-array-index-key -- parts have no identity beyond order
      <span key={index}>
        <span className="group-data-[bars=inside]/status-line:hidden">{part}% </span>
        <PercentBar value={part} color={props.color} />
      </span>
    ) : (
      part
    ),
  );
}

function Segments(props: { readonly line: ReadonlyArray<AnsiSegment> }) {
  return props.line.map((segment, segmentIndex) => (
    <span
      // oxlint-disable-next-line react/no-array-index-key -- segments have no identity beyond order
      key={segmentIndex}
      style={segmentStyle(segment)}
    >
      <SegmentText text={segment.text} color={segmentColor(segment)} />
    </span>
  ));
}

// An inline span keeps its content width even while its clipping parent is narrower.
function MeasuredSegments(props: {
  readonly line: ReadonlyArray<AnsiSegment>;
  readonly className?: string;
}) {
  return (
    <span data-status-line-part className={props.className}>
      <Segments line={props.line} />
    </span>
  );
}

// Labels sit beside bars only while the whole line fits; the flip is a DOM attribute, so no re-render.
function fitBars(row: HTMLElement) {
  row.dataset.bars = "outside";
  let needed = 0;
  for (const part of row.querySelectorAll<HTMLElement>("[data-status-line-part]")) {
    needed += part.offsetWidth;
  }
  if (needed > row.clientWidth) row.dataset.bars = "inside";
}

/** The text before the clock: a leading directory shrinks with an ellipsis before anything else is cut. */
function StatusLineLead(props: {
  readonly line: ReadonlyArray<AnsiSegment>;
  readonly className: string;
}) {
  const split = splitStatusLineDirectory(props.line);
  if (split === null) {
    return (
      <div className={cn("overflow-hidden text-ellipsis", props.className)}>
        <MeasuredSegments line={props.line} />
      </div>
    );
  }
  return (
    <div className={cn("flex overflow-hidden", props.className)}>
      <div className="min-w-0 overflow-hidden text-ellipsis">
        <MeasuredSegments line={split.directory} />
      </div>
      <div className="shrink-0">
        <MeasuredSegments line={split.rest} />
      </div>
    </div>
  );
}

/**
 * One status line row. Text before the clock is never cut for it, the clock sits at the right edge
 * and drops out when it would not fit, and text after the clock is cut first.
 */
function StatusLineRow(props: { readonly line: ReadonlyArray<AnsiSegment> }) {
  const rowRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-measures after each new line to place bar labels
  useLayoutEffect(() => {
    if (rowRef.current !== null) fitBars(rowRef.current);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-measures when the row's width changes
  useEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    return observeResize(row, () => fitBars(row));
  }, []);
  const split = splitStatusLineClock(props.line);
  return (
    <div
      ref={rowRef}
      className="group/status-line flex h-[1lh] min-w-0 flex-wrap overflow-hidden whitespace-pre"
    >
      {split === null ? (
        <StatusLineLead line={props.line} className="min-w-0 flex-1" />
      ) : (
        <>
          <StatusLineLead line={split.before} className="max-w-full" />
          <div className="min-w-0 flex-[1_1_0] overflow-hidden text-ellipsis">
            <MeasuredSegments line={split.after} />
          </div>
          <div className="shrink-0">
            <MeasuredSegments line={split.clock} className="pl-2" />
          </div>
        </>
      )}
    </div>
  );
}

/** Runs the environment's status line command for a thread, the way Claude Code draws its status line. */
export function ThreadStatusLineRunner(props: {
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
  const sessionKey = threadStatusLineKey(environmentId, props.source.threadId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the server's status line command
  useEffect(() => {
    if (!enabled) {
      publish(sessionKey, null);
      return;
    }
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
      publish(sessionKey, {
        lines: parseAnsiLines(response.value.text),
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the thread's line from the shared store
  useEffect(() => () => publish(sessionKey, null), [sessionKey]);

  return null;
}

/** On hover, the whole status line opens over the surrounding UI, wrapped and at full width. */
function StatusLineHover(props: {
  readonly lines: ReadonlyArray<ReadonlyArray<AnsiSegment>>;
  readonly anchor: "below" | "over";
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="pointer-events-auto min-w-0"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {props.children}
      {expanded ? (
        <div
          data-status-line-expanded="true"
          className={cn(
            "absolute inset-x-0 z-50 flex flex-col gap-0.5 rounded-md border bg-popover px-2 py-1.5 text-popover-foreground text-xs shadow-lg",
            // Below the top bar, with a bridge over the gap so the pointer can reach it.
            props.anchor === "below"
              ? "top-full rounded-t-none border-t-0 before:absolute before:inset-x-0 before:bottom-full before:h-6"
              : "bottom-0",
          )}
        >
          {props.lines.map((line, lineIndex) => (
            // oxlint-disable-next-line react/no-array-index-key -- lines have no identity beyond order
            <div key={lineIndex} className="whitespace-pre-wrap break-words">
              <Segments line={line} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The status line under the composer, across the chat's full width. */
export function ThreadStatusBar(props: { readonly sessionKey: string }) {
  const result = useStatusLineResult(props.sessionKey);
  if (result === null) return null;
  if (result.lines.length === 0) {
    if (result.error === null) return null;
    return (
      <div
        data-chat-status-line="error"
        className="pointer-events-auto -ms-(--chat-lane-inset-start,0px) -me-(--chat-lane-inset-end,0px) min-w-0 truncate px-1 pt-1.5 text-muted-foreground text-xs"
      >
        Status line failed: {result.error}
      </div>
    );
  }
  return (
    <div
      data-chat-status-line="true"
      // Spans the whole chat column, including the side the details panel insets the composer from.
      className="relative -ms-(--chat-lane-inset-start,0px) -me-(--chat-lane-inset-end,0px) min-w-0 px-1 pt-1.5 text-foreground text-xs"
    >
      <StatusLineHover lines={result.lines} anchor="over">
        {result.lines.map((line, lineIndex) => (
          // oxlint-disable-next-line react/no-array-index-key -- lines have no identity beyond order
          <StatusLineRow key={lineIndex} line={line} />
        ))}
      </StatusLineHover>
    </div>
  );
}

/** The status line in the thread's top bar, its lines joined into one. */
export function ThreadHeaderStatusLine(props: { readonly sessionKey: string }) {
  const result = useStatusLineResult(props.sessionKey);
  const line =
    result?.lines.flatMap((segments, index) =>
      index === 0 ? segments : [{ ...PLAIN_SEPARATOR }, ...segments],
    ) ?? [];
  if (result === null || line.length === 0) return null;
  // Not positioned itself, so the hover panel spans the whole top bar and opens below it.
  return (
    <div
      data-chat-header-status-line="true"
      className="min-w-0 flex-1 text-muted-foreground text-xs"
    >
      <StatusLineHover lines={result.lines} anchor="below">
        <StatusLineRow line={line} />
      </StatusLineHover>
    </div>
  );
}

const PLAIN_SEPARATOR: AnsiSegment = {
  text: "  ",
  color: null,
  background: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};
