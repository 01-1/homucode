import {
  formatStatusLineSpan,
  formatStatusLineTokens,
  type StatusLineLimit,
  type StatusLineStats,
} from "@t3tools/client-runtime/status-line";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DatabaseIcon,
  FolderIcon,
  RotateCwIcon,
  TimerIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { formatShortTimestamp } from "../../timestampFormat";

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_BAR_HEIGHTS = ["h-1", "h-1.5", "h-2", "h-2.5", "h-3"];

// A long context window is fine half full; a usage limit half spent is worth a look.
const CONTEXT_ALERTS = [70, 90] as const;
const LIMIT_ALERTS = [50, 80] as const;

type Alerts = readonly [warnAt: number, errorAt: number];

function gaugeColor(percent: number, [warnAt, errorAt]: Alerts): string {
  if (percent >= errorAt) return "var(--destructive)";
  return percent >= warnAt ? "var(--warning-foreground)" : "var(--success-foreground)";
}

// Past its reset time a limit's number is the old window's, until the provider reports again.
function windowEnded(limit: StatusLineLimit, nowMs: number): boolean {
  return limit.resetsAtMs !== null && limit.resetsAtMs <= nowMs;
}

function resetsIn(limit: StatusLineLimit, nowMs: number): string | null {
  return limit.resetsAtMs === null || windowEnded(limit, nowMs)
    ? null
    : formatStatusLineSpan(limit.resetsAtMs - nowMs);
}

function limitNote(limit: StatusLineLimit, nowMs: number): string {
  if (windowEnded(limit, nowMs)) return "window ended";
  const left = resetsIn(limit, nowMs);
  return left === null ? "" : `resets in ${left}`;
}

function uptimeText(createdAt: string | null, nowMs: number): string | null {
  const startedMs = createdAt === null ? Number.NaN : Date.parse(createdAt);
  return Number.isFinite(startedMs) ? formatStatusLineSpan(nowMs - startedMs) : null;
}

/** Effort as signal bars, one lit for low and all five for max. Other levels are written out. */
function Effort(props: { readonly effort: string }) {
  const level = props.effort.startsWith("ultra") ? 5 : EFFORT_LEVELS.indexOf(props.effort) + 1;
  if (level === 0) {
    return <span className="font-normal text-2xs text-muted-foreground">{props.effort}</span>;
  }
  return (
    <span
      role="img"
      aria-label={`${props.effort} effort`}
      className="flex shrink-0 items-end gap-px"
    >
      {EFFORT_BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          className={`w-[3px] rounded-xs ${height} ${index < level ? "bg-foreground" : "bg-foreground/30"}`}
        />
      ))}
    </span>
  );
}

// At the error level the disc fills too, since a theme's error color can sit close to its accent.
function Ring(props: { readonly percent: number; readonly alarm: boolean }) {
  return (
    <svg viewBox="0 0 26 26" className="size-[26px] shrink-0" aria-hidden>
      <circle
        cx="13"
        cy="13"
        r="10.5"
        fill={props.alarm ? "currentColor" : "none"}
        fillOpacity="0.3"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="3"
      />
      {props.percent === 0 ? null : (
        <circle
          cx="13"
          cy="13"
          r="10.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${props.percent} 100`}
          transform="rotate(-90 13 13)"
        />
      )}
      <text
        x="13"
        y="13.4"
        textAnchor="middle"
        dominantBaseline="central"
        className={`fill-foreground font-semibold ${props.percent === 100 ? "text-4xs" : "text-3xs"}`}
      >
        {props.percent}
      </text>
    </svg>
  );
}

/** A ring filled to `percent` with the number inside, then what it measures and a detail. */
function Dial(props: {
  readonly percent: number;
  readonly alerts: Alerts;
  readonly name: string;
  readonly detail: ReactNode;
  readonly label: string;
  readonly className?: string;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(props.percent)));
  return (
    <span
      role="img"
      aria-label={props.label}
      className={`flex shrink-0 items-center gap-1.5 ${props.className ?? ""}`}
      style={{ color: gaugeColor(percent, props.alerts) }}
    >
      <Ring percent={percent} alarm={percent >= props.alerts[1]} />
      <span className="grid @max-[20rem]/dials:hidden">
        <span className="font-medium text-2xs/3.5 text-foreground">{props.name}</span>
        {props.detail === null ? null : (
          <span className="flex items-center gap-0.5 text-3xs/3 text-muted-foreground @max-[24rem]/dials:hidden [&_svg]:size-2.5">
            {props.detail}
          </span>
        )}
      </span>
    </span>
  );
}

function LimitDial(props: {
  readonly limit: StatusLineLimit;
  readonly nowMs: number;
  readonly name: string;
  readonly title: string;
  readonly className: string;
}) {
  const left = resetsIn(props.limit, props.nowMs);
  const note = limitNote(props.limit, props.nowMs);
  return (
    <Dial
      percent={props.limit.usedPercent}
      alerts={LIMIT_ALERTS}
      name={props.name}
      detail={
        left === null ? null : (
          <>
            <RotateCwIcon />
            {left}
          </>
        )
      }
      label={`${props.title} ${props.limit.usedPercent}% used${note === "" ? "" : `, ${note}`}`}
      className={`${props.className} ${windowEnded(props.limit, props.nowMs) ? "opacity-50" : ""}`}
    />
  );
}

function Stat(props: {
  readonly label: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      role="img"
      aria-label={props.label}
      className={`flex shrink-0 items-center gap-1 text-2xs [&_svg]:size-3 ${props.className}`}
    >
      {props.children}
    </span>
  );
}

/**
 * The status line as gauges in the top bar. What runs out (context and the usage limits) is a
 * dial; the rest are small icons. As the bar narrows the icons leave first, then the clock and the
 * captions, and the dials last.
 */
export function StatusDialStrip(props: {
  readonly stats: StatusLineStats;
  readonly createdAt: string | null;
  readonly nowMs: number;
}) {
  const { stats, nowMs } = props;
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const uptime = uptimeText(props.createdAt, nowMs);
  const context = stats.contextTokens === null ? null : formatStatusLineTokens(stats.contextTokens);
  const hasDial = stats.contextPercent !== null || stats.fiveHour !== null || stats.weekly !== null;
  return (
    <div className="@container/dials">
      <div className="flex items-center gap-3.5 overflow-hidden whitespace-nowrap tabular-nums">
        {stats.modelName === null ? null : (
          <span
            // Beside dials the model goes when room is short; alone it stays, or nothing would.
            className={`flex min-w-0 items-center gap-1.5 font-medium text-foreground ${hasDial ? "@max-[14rem]/dials:hidden" : ""}`}
          >
            <span className="max-w-40 truncate">{stats.modelName}</span>
            {stats.effort === null ? null : <Effort effort={stats.effort} />}
            {stats.fastMode ? (
              <ZapIcon aria-label="Fast mode" className="size-3.5 shrink-0 fill-foreground" />
            ) : null}
          </span>
        )}
        {context === null ? null : stats.contextPercent === null ? (
          // No known maximum, so no ring: the count stands in for it.
          <Stat label={`Context ${context} tokens`} className="@max-[20rem]/dials:hidden">
            <span className="font-medium text-foreground">context</span>
            {context}
          </Stat>
        ) : (
          <Dial
            percent={stats.contextPercent}
            alerts={CONTEXT_ALERTS}
            name="context"
            detail={context}
            label={`Context ${stats.contextPercent}% used, ${context} tokens`}
          />
        )}
        {stats.fiveHour === null ? null : (
          <LimitDial
            limit={stats.fiveHour}
            nowMs={nowMs}
            name="5h"
            title="5-hour limit"
            className="@max-[4rem]/dials:hidden"
          />
        )}
        {stats.weekly === null ? null : (
          <LimitDial
            limit={stats.weekly}
            nowMs={nowMs}
            name="week"
            title="Weekly limit"
            className="@max-[6.5rem]/dials:hidden"
          />
        )}
        {uptime === null ? null : (
          <>
            <span aria-hidden className="h-4 w-px shrink-0 bg-border @max-[29rem]/dials:hidden" />
            <Stat label={`Uptime ${uptime}`} className="@max-[29rem]/dials:hidden">
              <TimerIcon />
              {uptime}
            </Stat>
          </>
        )}
        {stats.cachePercent === null ? null : (
          <Stat label={`Cache hits ${stats.cachePercent}%`} className="@max-[37rem]/dials:hidden">
            <DatabaseIcon />
            {stats.cachePercent}%
          </Stat>
        )}
        {stats.inputTokens === null ? null : (
          <Stat
            label={`${stats.inputTokens} tokens in, ${stats.outputTokens ?? 0} out`}
            className="@max-[44rem]/dials:hidden"
          >
            <ArrowDownIcon />
            {formatStatusLineTokens(stats.inputTokens)}
            <ArrowUpIcon />
            {formatStatusLineTokens(stats.outputTokens ?? 0)}
          </Stat>
        )}
        <span className="ms-auto shrink-0 ps-1 text-2xs @max-[33rem]/dials:hidden">
          {formatShortTimestamp(new Date(nowMs).toISOString(), timestampFormat)}
        </span>
      </div>
    </div>
  );
}

function Fact(props: {
  readonly name: string;
  readonly meter?: { readonly percent: number; readonly alerts: Alerts };
  readonly dimmed?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={`grid min-w-0 content-start gap-0.5 ${props.dimmed ? "opacity-50" : ""}`}>
      <span className="text-2xs text-muted-foreground">{props.name}</span>
      <span className="break-words font-medium">{props.children}</span>
      {props.meter === undefined ? null : (
        <span
          aria-hidden
          className="mt-0.5 h-1 overflow-hidden rounded-full bg-current/20"
          style={{ color: gaugeColor(props.meter.percent, props.meter.alerts) }}
        >
          <span
            className="block h-full rounded-full bg-current"
            style={{ width: `${Math.min(100, props.meter.percent)}%` }}
          />
        </span>
      )}
    </div>
  );
}

function LimitFact(props: {
  readonly name: string;
  readonly limit: StatusLineLimit;
  readonly nowMs: number;
}) {
  const note = limitNote(props.limit, props.nowMs);
  return (
    <Fact
      name={props.name}
      meter={{ percent: props.limit.usedPercent, alerts: LIMIT_ALERTS }}
      dimmed={windowEnded(props.limit, props.nowMs)}
    >
      {props.limit.usedPercent}%{note === "" ? null : ` · ${note}`}
    </Fact>
  );
}

/** Every value by name, with the folder and version the strip leaves out. */
export function StatusDialCard(props: {
  readonly stats: StatusLineStats;
  readonly createdAt: string | null;
  readonly nowMs: number;
}) {
  const { stats, nowMs } = props;
  const uptime = uptimeText(props.createdAt, nowMs);
  const model = [stats.modelName, stats.effort, stats.fastMode ? "fast" : null].filter(Boolean);
  return (
    <div className="grid gap-3 tabular-nums">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-x-6 gap-y-3">
        {stats.contextTokens === null ? null : (
          <Fact
            name="Context"
            {...(stats.contextPercent === null
              ? {}
              : { meter: { percent: stats.contextPercent, alerts: CONTEXT_ALERTS } })}
          >
            {stats.contextPercent === null ? null : `${stats.contextPercent}% · `}
            {formatStatusLineTokens(stats.contextTokens)}
            {stats.contextMaxTokens === null
              ? null
              : ` of ${formatStatusLineTokens(stats.contextMaxTokens)}`}
          </Fact>
        )}
        {stats.fiveHour === null ? null : (
          <LimitFact name="5-hour limit" limit={stats.fiveHour} nowMs={nowMs} />
        )}
        {stats.weekly === null ? null : (
          <LimitFact name="Weekly limit" limit={stats.weekly} nowMs={nowMs} />
        )}
        {uptime === null ? null : <Fact name="Uptime">{uptime}</Fact>}
        {stats.inputTokens === null ? null : (
          <Fact name="Tokens">
            {formatStatusLineTokens(stats.inputTokens)} in ·{" "}
            {formatStatusLineTokens(stats.outputTokens ?? 0)} out
            {stats.cachePercent === null ? null : ` · ${stats.cachePercent}% cached`}
          </Fact>
        )}
        {model.length === 0 ? null : <Fact name="Model">{model.join(" · ")}</Fact>}
      </div>
      {stats.cwd === null && stats.version === null ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-2xs text-muted-foreground">
          {stats.cwd === null ? null : (
            <span className="flex min-w-0 items-center gap-1">
              <FolderIcon className="size-3 shrink-0" />
              <span className="break-all">{stats.cwd}</span>
            </span>
          )}
          {stats.version === null ? null : <span>version {stats.version}</span>}
        </div>
      )}
    </div>
  );
}
