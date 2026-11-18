import type { EnvironmentId } from "@t3tools/contracts";
import {
  type AnsiSegment,
  buildStatusLineInput,
  buildStatusLineStats,
  expandStatusLineLabel,
  parseAnsiLines,
  reserveStatusLineText,
  splitStatusLineItems,
  stampStatusLineInput,
  statusLineInputModelName,
  type StatusLineColorRole,
  statusLineColorRole,
  type StatusLineInputSource,
  type StatusLineItem,
  type StatusLineStats,
} from "@t3tools/client-runtime/status-line";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import {
  type CSSProperties,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useNowMinuteMs } from "../../hooks/useNowMinute";
import { observeResize } from "~/lib/observeResize";
import { serverEnvironment } from "../../state/server";
import { StatusDialCard, StatusDialStrip } from "./ThreadStatusDials";

// Claude Code redraws on events; the timer keeps clocks and countdowns current while idle.
const REFRESH_MS = 30_000;
const DEBOUNCE_MS = 300;
const RETRY_MS = 2_000;

// A custom command's output is drawn as text; without one the client draws the stats itself.
type StatusLineResult =
  | {
      readonly lines: ReadonlyArray<ReadonlyArray<AnsiSegment>>;
      readonly error: string | null;
      /** The name the script was given, to write out where the line shortens it. */
      readonly modelName: string | null;
    }
  | { readonly stats: StatusLineStats; readonly createdAt: string | null };

// The runner sits in the chat view, which has its input; the top bar reads the result from here.
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
    ...(segment.background === null ? {} : { backgroundColor: "var(--muted)" }),
    ...(segment.bold ? { fontWeight: 600 } : {}),
    ...(segment.dim ? { opacity: 0.6 } : {}),
    ...(segment.italic ? { fontStyle: "italic" } : {}),
    ...(segment.underline ? { textDecoration: "underline" } : {}),
  };
}

const PERCENT_PATTERN = /(\d+(?:\.\d+)?)%/g;

// Trims the label's box to its digits, so centering it centers what is seen.
const BAR_LABEL = "col-start-1 row-start-1 hidden [text-box:trim-both_cap_alphabetic] leading-none";
const BAR_FILL = "color-mix(in oklab, currentColor 40%, transparent)";

/**
 * A percentage as `8% [bar]`. In a tight line the label moves inside the bar, where it keeps the
 * line's baseline. An empty bar has no baseline, so it is raised to sit centered on the digits.
 * The fill is a background, not a positioned box, which would still paint where the line is cut.
 */
function Percent(props: { readonly value: string }) {
  const filled = `${Math.min(100, Number(props.value))}%`;
  return (
    <>
      <span className="group-data-[room=tight]/status-line:hidden">{props.value}% </span>
      <span
        className="inline-grid h-4 w-8 place-items-center rounded-xs bg-current/25 align-[calc((1cap-1rem)/2)] group-data-[room=tight]/status-line:w-auto group-data-[room=tight]/status-line:px-1.5 group-data-[room=tight]/status-line:align-baseline"
        style={{
          backgroundImage: `linear-gradient(90deg, ${BAR_FILL} ${filled}, transparent ${filled})`,
        }}
      >
        <span
          aria-hidden
          className={`invisible ${BAR_LABEL} group-data-[room=tight]/status-line:block`}
        >
          100%
        </span>
        <span className={`${BAR_LABEL} group-data-[room=tight]/status-line:block`}>
          {props.value}%
        </span>
      </span>
    </>
  );
}

function SegmentText(props: { readonly text: string }) {
  const parts = props.text.split(PERCENT_PATTERN);
  if (parts.length === 1) return props.text;
  return parts.map((part, index) =>
    // oxlint-disable-next-line react/no-array-index-key -- parts have no identity beyond order
    index % 2 === 1 ? <Percent key={index} value={part} /> : part,
  );
}

/**
 * Styled text. A line with room writes abbreviated labels and the model name out. `reserved` gives
 * each changing value its room instead, which is how an item measures the room to hold.
 */
function Segments(props: {
  readonly line: ReadonlyArray<AnsiSegment>;
  readonly modelName?: string | null;
  readonly reserved?: boolean;
}) {
  return props.line.map((segment, segmentIndex) => {
    const expanded = expandStatusLineLabel(segment, props.modelName);
    return (
      <span
        // oxlint-disable-next-line react/no-array-index-key -- segments have no identity beyond order
        key={segmentIndex}
        style={segmentStyle(segment)}
      >
        {expanded === null ? (
          <SegmentText text={props.reserved ? reserveStatusLineText(segment) : segment.text} />
        ) : (
          <>
            <span className="group-data-[labels=long]/status-line:hidden">{segment.text}</span>
            <span className="hidden group-data-[labels=long]/status-line:inline">{expanded}</span>
          </>
        )}
      </span>
    );
  });
}

// The gap after an item grows with the room the line has.
const ITEM_GAP =
  "pe-1.5 group-data-[room=normal]/status-line:pe-2.5 group-data-[room=wide]/status-line:pe-3.5";

// Indexed by drop level: what hides an item dropped at that level, and what shows a separator.
const DROPPED = [
  "",
  "group-data-[drop=1]/status-line:hidden group-data-[drop=2]/status-line:hidden group-data-[drop=3]/status-line:hidden",
  "group-data-[drop=2]/status-line:hidden group-data-[drop=3]/status-line:hidden",
  "group-data-[drop=3]/status-line:hidden",
];
const SHOWN = [
  "group-data-[drop=0]/status-line:inline",
  "group-data-[drop=1]/status-line:inline",
  "group-data-[drop=2]/status-line:inline",
  "group-data-[drop=3]/status-line:inline",
];

// A ` |` stands between two parts of the line, so it keeps the item gap on both sides.
const PIPE_GAP =
  "ps-1.5 group-data-[room=normal]/status-line:ps-2.5 group-data-[room=wide]/status-line:ps-3.5";

/** The separator after an item, which depends on what the line has dropped. */
function Separator(props: { readonly item: StatusLineItem }) {
  const { separators } = props.item;
  // Levels that share a separator share its array, so a Set leaves one span for each.
  return [...new Set(separators)].map((separator, index) => {
    if (separator.length === 0) return null;
    const shown = SHOWN.filter((_, level) => separators[level] === separator).join(" ");
    const pipe = separator.some((segment) => segment.text.includes("|")) ? PIPE_GAP : "";
    return (
      <span
        // oxlint-disable-next-line react/no-array-index-key -- separators have no identity beyond order
        key={index}
        className={`hidden ${shown} ${pipe}`}
      >
        <Segments line={separator} />
      </span>
    );
  });
}

/**
 * One item in a slot of fixed width: an invisible copy with room for its values to change shares
 * the slot, so the items after it stay put while this one's value changes.
 */
function StatusLineSlot(props: {
  readonly item: StatusLineItem;
  readonly beforeClock: boolean;
  readonly modelName: string | null;
}) {
  return (
    <span
      data-status-line-item={props.beforeClock ? "before-clock" : "after-clock"}
      className={`inline-grid ${ITEM_GAP} ${DROPPED[props.item.dropAt]}`}
    >
      <span className="col-start-1 row-start-1">
        <Segments line={props.item.segments} modelName={props.modelName} />
        <Separator item={props.item} />
      </span>
      <span aria-hidden className="invisible col-start-1 row-start-1">
        <Segments line={props.item.segments} modelName={props.modelName} reserved />
        <Separator item={props.item} />
      </span>
    </span>
  );
}

// From roomiest to tightest: labels written out or short, how much room the gaps take, how many
// low-priority items are dropped, and whether the directory may shorten. Tight also moves
// percentages inside their bars.
const FITS = [
  ["long", "wide", 0, false],
  ["long", "normal", 0, false],
  ["short", "normal", 0, false],
  ["short", "normal", 1, false],
  ["short", "normal", 2, false],
  ["short", "normal", 2, true],
  ["short", "normal", 3, true],
  ["short", "tight", 3, true],
] as const;

// What a shortened directory keeps: room for a name or two.
const DIRECTORY_FLOOR_PX = 72;

function itemsWidth(row: HTMLElement, kinds: ReadonlyArray<string>): number {
  const selector = kinds.map((kind) => `[data-status-line-item="${kind}"]`).join(",");
  let width = 0;
  for (const item of row.querySelectorAll(selector)) width += item.getBoundingClientRect().width;
  return width;
}

// A theme can give the top bar its own font; the status line keeps the app's normal one.
function keepBodyFont(element: HTMLElement | null | undefined) {
  if (!element) return;
  const fontFamily = getComputedStyle(document.body).fontFamily;
  if (element.style.fontFamily !== fontFamily) element.style.fontFamily = fontFamily;
}

// Picks the roomiest fit the whole line has room for. Past the last one the tail is cut, and the
// clock stays only while everything before it in the line still fits. DOM attributes, so no
// re-render.
function fitRow(row: HTMLElement) {
  // The row's effect runs before its parent's, so the font is set here, ahead of measuring.
  keepBodyFont(row.parentElement);
  row.dataset.clock = "shown";
  // A pixel short of the edge, so rounding never clips the last item.
  const space = row.getBoundingClientRect().width - 1;
  for (const [labels, room, drop, shorten] of FITS) {
    row.dataset.labels = labels;
    row.dataset.room = room;
    row.dataset.drop = String(drop);
    const directory = itemsWidth(row, ["directory"]);
    const rest = itemsWidth(row, ["before-clock", "after-clock", "clock"]);
    const floor = Math.min(directory, DIRECTORY_FLOOR_PX);
    row.style.setProperty("--status-line-directory-floor", `${floor}px`);
    if ((shorten ? floor : directory) + rest <= space) return;
  }
  // The cut tail ends in an ellipsis, which needs up to 1em beside the items before the clock.
  const ellipsis = Number.parseFloat(getComputedStyle(row).fontSize);
  if (itemsWidth(row, ["directory", "before-clock", "clock"]) + ellipsis > space) {
    row.dataset.clock = "hidden";
  }
}

/**
 * The status line on one row: the directory, which shortens before anything is cut, then each item
 * in its slot, then the clock at the right edge.
 */
function StatusLineRow(props: {
  readonly lines: ReadonlyArray<ReadonlyArray<AnsiSegment>>;
  readonly modelName: string | null;
}) {
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
  const items = props.lines.flatMap(splitStatusLineItems);
  const directory = items[0]?.kind === "directory" ? items[0] : null;
  const clock = items.find((item) => item.kind === "clock");
  const clockIndex = clock === undefined ? -1 : items.indexOf(clock);
  return (
    <div
      ref={rowRef}
      className="group/status-line flex min-w-0 items-baseline overflow-hidden whitespace-pre tabular-nums"
    >
      {directory === null ? null : (
        <>
          <div
            className={`min-w-(--status-line-directory-floor) shrink-[9999] overflow-hidden text-ellipsis ${DROPPED[directory.dropAt]}`}
          >
            <span data-status-line-item="directory">
              <Segments line={directory.segments} />
            </span>
          </div>
          <div
            data-status-line-item="before-clock"
            className={`shrink-0 ${ITEM_GAP} ${DROPPED[directory.dropAt]}`}
          >
            <Separator item={directory} />
          </div>
        </>
      )}
      <div className="min-w-0 overflow-hidden text-ellipsis">
        {items.map((item, index) =>
          item === directory || item === clock ? null : (
            <StatusLineSlot
              // oxlint-disable-next-line react/no-array-index-key -- items have no identity beyond order
              key={index}
              item={item}
              beforeClock={index < clockIndex}
              modelName={props.modelName}
            />
          ),
        )}
      </div>
      {clock === undefined ? null : (
        <div
          data-status-line-item="clock"
          className="ms-auto shrink-0 group-data-[clock=hidden]/status-line:hidden"
        >
          <Segments line={clock.segments} />
        </div>
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
  const custom = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) => (config?.settings.statusLineCommand ?? "") !== "",
  );
  const registry = useContext(RegistryContext);
  // Limits are read on the minute so the key, and with it the command, only changes on new data.
  const source = { ...props.source, nowMs: useNowMinuteMs() };
  // Only the mode in use reads the thread's state; the other key stays empty.
  const inputKey = custom ? JSON.stringify(buildStatusLineInput(source)) : "";
  const statsKey = custom ? "" : JSON.stringify(buildStatusLineStats(source));
  const modelName = statusLineInputModelName(props.source);
  const resultAtom = statusLineResultAtom(props.statusLineKey);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the server's status line command
  useEffect(() => {
    if (!enabled) {
      registry.set(resultAtom, null);
      return;
    }
    if (!custom) {
      // Parsed back from the key, which is what tells the effect the stats changed.
      const stats: StatusLineStats = JSON.parse(statsKey);
      registry.set(resultAtom, { stats, createdAt });
      return;
    }
    // Dials left from before a command was set go at once, not when its first draw lands.
    const shown = registry.get(resultAtom);
    if (shown !== null && "stats" in shown) registry.set(resultAtom, null);
    let cancelled = false;
    // The first draw can land before the environment reconnects; it retries without waiting a refresh.
    let quickRetries = 5;
    let timer: number | undefined;
    const draw = async () => {
      let delay = REFRESH_MS;
      if (document.visibilityState !== "hidden") {
        const input = stampStatusLineInput(JSON.parse(inputKey), createdAt, Date.now());
        const response = await runAtomCommand(
          registry,
          serverEnvironment.renderStatusLine,
          { environmentId, input: { input } },
          { reportFailure: false },
        );
        if (cancelled) return;
        if (response._tag === "Success") {
          registry.set(resultAtom, {
            lines: parseAnsiLines(response.value.text),
            error: response.value.error ?? null,
            modelName,
          });
        } else if (quickRetries > 0) {
          quickRetries = quickRetries - 1;
          delay = RETRY_MS;
        }
      }
      timer = window.setTimeout(() => void draw(), delay);
    };
    timer = window.setTimeout(() => void draw(), DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    custom,
    inputKey,
    statsKey,
    modelName,
    createdAt,
    environmentId,
    resultAtom,
    registry,
  ]);

  return null;
}

// Under the top bar, which is the positioned ancestor. The strip before it bridges the gap above,
// so the pointer can reach the panel from the line.
const PANEL =
  "absolute top-full z-50 rounded-md rounded-t-none border border-t-0 bg-popover text-popover-foreground shadow-lg before:absolute before:inset-x-0 before:bottom-full before:h-6";

/** The status line in the thread's top bar. On hover or keyboard focus it opens in full under the bar. */
export function ThreadHeaderStatusLine(props: { readonly statusLineKey: string }) {
  const result = useAtomValue(statusLineResultAtom(props.statusLineKey));
  if (result === null) return null;
  const drawn = "stats" in result;
  if (!drawn && result.lines.length === 0 && result.error === null) return null;
  // Keyed by what is drawn, so an open panel does not carry over when that changes.
  return <HeaderStatusLine key={drawn ? "dials" : "text"} result={result} />;
}

function HeaderStatusLine(props: { readonly result: StatusLineResult }) {
  const { result } = props;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Where the line starts in the top bar, which is where the dials' card starts.
  const [left, setLeft] = useState(0);
  const nowMs = useNowMinuteMs();
  const containerRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the theme's font from the page
  useLayoutEffect(() => keepBodyFont(containerRef.current));
  const drawn = "stats" in result;
  const failed = !drawn && result.lines.length === 0;
  const measure = (line: HTMLElement) => {
    const bar = line.offsetParent?.getBoundingClientRect().left ?? 0;
    setLeft(line.getBoundingClientRect().left - bar);
  };
  // Not positioned itself, so the panel is placed against the whole top bar and opens below it.
  // No-drag, or Electron's title bar drag region swallows the hover.
  return (
    <div
      ref={containerRef}
      data-chat-header-status-line={failed ? "error" : "true"}
      tabIndex={0}
      aria-label="Status line"
      className="min-w-0 flex-1 rounded-sm text-muted-foreground text-xs outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onMouseEnter={() => setHovered(true)}
      // On each move, since the line shifts under the pointer when the title beside it changes.
      onMouseMove={(event) => measure(event.currentTarget)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) => {
        // A click focuses it too, and must not pin the panel open.
        if (!event.currentTarget.matches(":focus-visible")) return;
        measure(event.currentTarget);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setHovered(false);
        setFocused(false);
      }}
    >
      {drawn ? (
        <StatusDialStrip stats={result.stats} createdAt={result.createdAt} nowMs={nowMs} />
      ) : failed ? (
        <div className="truncate">Status line failed: {result.error}</div>
      ) : (
        <StatusLineRow lines={result.lines} modelName={result.modelName} />
      )}
      {failed || !(hovered || focused) ? null : drawn ? (
        <div
          className={`${PANEL} w-3xl px-4 py-3`}
          style={{ left, maxWidth: `calc(100% - ${left}px - 0.75rem)` }}
        >
          <StatusDialCard stats={result.stats} createdAt={result.createdAt} nowMs={nowMs} />
        </div>
      ) : (
        <div
          data-labels="long"
          className={`group/status-line ${PANEL} inset-x-0 flex flex-col gap-0.5 px-2 py-1.5 tabular-nums`}
        >
          {result.lines.map((line, lineIndex) => (
            // oxlint-disable-next-line react/no-array-index-key -- lines have no identity beyond order
            <div key={lineIndex} className="whitespace-pre-wrap break-words">
              <Segments line={line} modelName={result.modelName} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
