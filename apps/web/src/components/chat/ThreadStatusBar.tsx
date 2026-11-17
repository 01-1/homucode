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
import { Atom } from "effect/reactivity";
import {
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
const statusLineResultAtom = Atom.family((_key: string) =>
  Atom.make<StatusLineResult | null>(null),
);

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
  const themeColor = ROLE_COLORS[statusLineColorRole(color)];
  return themeColor === null
    ? "var(--muted)"
    : `color-mix(in srgb, ${themeColor} 18%, transparent)`;
}

function segmentStyle(segment: AnsiSegment): CSSProperties | undefined {
  const color = segment.color === null ? null : ROLE_COLORS[statusLineColorRole(segment.color)];
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
function PercentBar(props: { readonly value: string }) {
  return (
    <span className="relative inline-flex h-3 w-6 overflow-hidden rounded-xs bg-current/15 align-[-2px] group-data-[bars=inside]/status-line:w-9">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-current/40"
        style={{ width: `${Math.min(100, Number(props.value))}%` }}
      />
      <span className="relative hidden w-full text-center leading-3 group-data-[bars=inside]/status-line:block">
        {props.value}%
      </span>
    </span>
  );
}

function SegmentText(props: { readonly text: string }) {
  const parts = props.text.split(PERCENT_PATTERN);
  if (parts.length === 1) return props.text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      // oxlint-disable-next-line react/no-array-index-key -- parts have no identity beyond order
      <span key={index}>
        <span className="group-data-[bars=inside]/status-line:hidden">{part}% </span>
        <PercentBar value={part} />
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
      <SegmentText text={segment.text} />
    </span>
  ));
}

type StatusLinePart = "lead" | "after" | "clock";

// fitRow sums these spans' widths; an inline span keeps its content width while its parent clips it.
function MeasuredSegments(props: {
  readonly line: ReadonlyArray<AnsiSegment>;
  readonly part: StatusLinePart;
}) {
  return (
    <span data-status-line-part={props.part}>
      <Segments line={props.line} />
    </span>
  );
}

function partsWidth(row: HTMLElement, parts: ReadonlyArray<StatusLinePart>): number {
  let width = 0;
  for (const part of row.querySelectorAll<HTMLElement>("[data-status-line-part]")) {
    if (parts.includes(part.dataset.statusLinePart as StatusLinePart)) width += part.offsetWidth;
  }
  return width;
}

// Bar labels sit beside their bars only while the whole line fits. Past that the labels fold into
// the bars, then the clock and the text after it hide together. DOM attributes, so no re-render.
function fitRow(row: HTMLElement) {
  row.dataset.bars = "outside";
  row.dataset.clock = "shown";
  if (partsWidth(row, ["lead", "after", "clock"]) <= row.clientWidth) return;
  row.dataset.bars = "inside";
  if (partsWidth(row, ["lead", "clock"]) > row.clientWidth) row.dataset.clock = "hidden";
}

/** The text before the clock. A leading directory is the part of it that shrinks, with an ellipsis. */
function StatusLineLead(props: { readonly line: ReadonlyArray<AnsiSegment> }) {
  const split = splitStatusLineDirectory(props.line);
  if (split === null) {
    return (
      <div className="min-w-0 overflow-hidden text-ellipsis">
        <MeasuredSegments line={props.line} part="lead" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 overflow-hidden">
      <div className="min-w-8 overflow-hidden text-ellipsis">
        <MeasuredSegments line={split.directory} part="lead" />
      </div>
      <div className="shrink-0">
        <MeasuredSegments line={split.rest} part="lead" />
      </div>
    </div>
  );
}

/** One status line row: the text before the clock, then the text after it, then the clock at the right edge. */
function StatusLineRow(props: { readonly line: ReadonlyArray<AnsiSegment> }) {
  const rowRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-measures each new line to fit it
  useLayoutEffect(() => {
    if (rowRef.current !== null) fitRow(rowRef.current);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-measures when the row's width changes
  useEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    return observeResize(row, () => fitRow(row));
  }, []);
  const split = splitStatusLineClock(props.line);
  return (
    <div ref={rowRef} className="group/status-line flex min-w-0 overflow-hidden whitespace-pre">
      {split === null ? (
        <StatusLineLead line={props.line} />
      ) : (
        <>
          <StatusLineLead line={split.before} />
          <div className="min-w-0 flex-1 overflow-hidden text-ellipsis group-data-[clock=hidden]/status-line:hidden">
            <MeasuredSegments line={split.after} part="after" />
          </div>
          {/* Not clipped, so its own width (with the gap) is what fitRow measures. */}
          <div
            data-status-line-part="clock"
            className="shrink-0 pl-2 group-data-[clock=hidden]/status-line:hidden"
          >
            <Segments line={split.clock} />
          </div>
        </>
      )}
    </div>
  );
}

/** Runs the environment's status line command for a thread, the way Claude Code draws its status line. */
export function ThreadStatusLineRunner(props: {
  readonly statusLineKey: string;
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
  const resultAtom = statusLineResultAtom(props.statusLineKey);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the server's status line command
  useEffect(() => {
    if (!enabled) {
      registry.set(resultAtom, null);
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
      registry.set(resultAtom, {
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
  }, [enabled, inputKey, createdAt, environmentId, resultAtom, registry]);

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
export function ThreadStatusBar(props: { readonly statusLineKey: string }) {
  const result = useAtomValue(statusLineResultAtom(props.statusLineKey));
  if (result === null || (result.lines.length === 0 && result.error === null)) return null;
  const failed = result.lines.length === 0;
  return (
    <div
      data-chat-status-line={failed ? "error" : "true"}
      // Spans the whole chat column, including the side the details panel insets the composer from.
      className="relative -ms-(--chat-lane-inset-start,0px) -me-(--chat-lane-inset-end,0px) min-w-0 px-1 pt-1.5 text-foreground text-xs"
    >
      {failed ? (
        <div className="pointer-events-auto truncate text-muted-foreground">
          Status line failed: {result.error}
        </div>
      ) : (
        <StatusLineHover lines={result.lines} anchor="over">
          {result.lines.map((line, lineIndex) => (
            // oxlint-disable-next-line react/no-array-index-key -- lines have no identity beyond order
            <StatusLineRow key={lineIndex} line={line} />
          ))}
        </StatusLineHover>
      )}
    </div>
  );
}

/** The status line in the thread's top bar, its lines joined into one. */
export function ThreadHeaderStatusLine(props: { readonly statusLineKey: string }) {
  const result = useAtomValue(statusLineResultAtom(props.statusLineKey));
  const line =
    result?.lines.flatMap(([first, ...rest], index) =>
      first === undefined
        ? []
        : [index === 0 ? first : { ...first, text: `  ${first.text}` }, ...rest],
    ) ?? [];
  if (result === null || line.length === 0) return null;
  // Not positioned itself, so the hover panel spans the whole top bar and opens below it.
  // No-drag, or Electron's title bar drag region swallows the hover.
  return (
    <div
      data-chat-header-status-line="true"
      className="min-w-0 flex-1 text-muted-foreground text-xs [-webkit-app-region:no-drag]"
    >
      <StatusLineHover lines={result.lines} anchor="below">
        <StatusLineRow line={line} />
      </StatusLineHover>
    </div>
  );
}
