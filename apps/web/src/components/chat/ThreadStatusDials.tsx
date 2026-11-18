import {
  formatStatusLineSpan,
  formatStatusLineTokens,
  type StatusLineLimit,
  type StatusLineStats,
} from "@t3tools/client-runtime/status-line";
import { ArrowDownIcon, ArrowUpIcon, DatabaseIcon, TimerIcon, ZapIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_BAR_HEIGHTS = ["h-1", "h-1.5", "h-2", "h-2.5", "h-3"];

function useNowMs(): number {
  return Date.parse(`${useNowMinute()}:00Z`);
}

// Green while there is plenty left, then the theme's warning and error colors as it runs out.
function gaugeColor(percent: number): string {
  if (percent >= 80) return "var(--error-foreground)";
  return percent >= 50 ? "var(--warning-foreground)" : "var(--success-foreground)";
}

function timeLeft(limit: StatusLineLimit, nowMs: number): string | null {
  return limit.resetsAtMs === null ? null : formatStatusLineSpan(limit.resetsAtMs - nowMs);
}

function leftText(limit: StatusLineLimit, nowMs: number): string | null {
  const left = timeLeft(limit, nowMs);
  return left === null ? null : `${left} left`;
}

/** Effort as signal bars: one lit for low, all five for max. */
function EffortBars(props: { readonly effort: string }) {
  const level = props.effort.startsWith("ultra") ? 5 : EFFORT_LEVELS.indexOf(props.effort) + 1;
  if (level === 0) return null;
  return (
    <span role="img" aria-label={`${props.effort} effort`} className="flex shrink-0 items-end gap-px">
      {EFFORT_BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          className={`w-[3px] rounded-[1px] ${height} ${index < level ? "bg-ring" : "bg-ring/25"}`}
        />
      ))}
    </span>
  );
}

/** A ring filled to `percent`, with the number inside and what it measures beside it. */
function Dial(props: {
  readonly percent: number;
  readonly name: string;
  readonly detail: string | null;
  readonly label: string;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(props.percent)));
  return (
    <span
      role="img"
      aria-label={props.label}
      className="flex shrink-0 items-center gap-1.5"
      style={{ color: gaugeColor(percent) }}
    >
      <svg viewBox="0 0 26 26" className="size-[26px]" aria-hidden>
        <circle cx="13" cy="13" r="10.5" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        {percent === 0 ? null : (
          <circle
            cx="13"
            cy="13"
            r="10.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${percent} 100`}
            transform="rotate(-90 13 13)"
          />
        )}
        <text
          x="13"
          y="13.4"
          textAnchor="middle"
          dominantBaseline="central"
          className={`fill-foreground font-semibold ${percent === 100 ? "text-[8px]" : "text-[9.5px]"}`}
        >
          {percent}
        </text>
      </svg>
      <span className="grid leading-[1.15] @max-[30rem]/dials:hidden">
        <span className="font-medium text-[11px] text-foreground">{props.name}</span>
        {props.detail === null ? null : (
          <span className="text-[10px] text-muted-foreground">{props.detail}</span>
        )}
      </span>
    </span>
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
      className={`flex shrink-0 items-center gap-1 text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground ${props.className}`}
    >
      {props.children}
    </span>
  );
}

/**
 * The status line as gauges in the top bar. What runs out (context and the usage limits) is a dial;
 * the rest are small icons that leave first when the bar is short of room.
 */
export function StatusDialStrip(props: {
  readonly stats: StatusLineStats;
  readonly createdAt: string | null;
}) {
  const { stats } = props;
  const nowMs = useNowMs();
  const startedMs = props.createdAt === null ? Number.NaN : Date.parse(props.createdAt);
  const uptime = Number.isFinite(startedMs) ? formatStatusLineSpan(nowMs - startedMs) : null;
  const clock = new Date(nowMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (
    <div className="@container/dials">
      <div className="flex items-center gap-3.5 overflow-hidden whitespace-nowrap tabular-nums">
        {stats.modelName === null ? null : (
          <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
            <span className="truncate">{stats.modelName}</span>
            {stats.effort === null ? null : <EffortBars effort={stats.effort} />}
            {stats.fastMode ? (
              <ZapIcon aria-label="Fast mode" className="size-3.5 shrink-0 fill-ring text-ring" />
            ) : null}
          </span>
        )}
        {stats.contextPercent === null ? null : (
          <Dial
            percent={stats.contextPercent}
            name="context"
            detail={formatStatusLineTokens(stats.contextTokens ?? 0)}
            label={`Context ${stats.contextPercent}% used`}
          />
        )}
        {stats.fiveHour === null ? null : (
          <Dial
            percent={stats.fiveHour.usedPercent}
            name="5h"
            detail={leftText(stats.fiveHour, nowMs)}
            label={`5-hour limit ${stats.fiveHour.usedPercent}% used`}
          />
        )}
        {stats.weekly === null ? null : (
          <Dial
            percent={stats.weekly.usedPercent}
            name="week"
            detail={leftText(stats.weekly, nowMs)}
            label={`Weekly limit ${stats.weekly.usedPercent}% used`}
          />
        )}
        <span aria-hidden className="h-4 w-px shrink-0 bg-border @max-[36rem]/dials:hidden" />
        {uptime === null ? null : (
          <Stat label={`Uptime ${uptime}`} className="@max-[36rem]/dials:hidden">
            <TimerIcon />
            {uptime}
          </Stat>
        )}
        {stats.cachePercent === null ? null : (
          <Stat label={`Cache hits ${stats.cachePercent}%`} className="@max-[42rem]/dials:hidden">
            <DatabaseIcon />
            {stats.cachePercent}%
          </Stat>
        )}
        {stats.inputTokens === null ? null : (
          <Stat
            label={`${stats.inputTokens} tokens in, ${stats.outputTokens ?? 0} out`}
            className="@max-[50rem]/dials:hidden"
          >
            <ArrowDownIcon />
            {formatStatusLineTokens(stats.inputTokens)}
            <ArrowUpIcon />
            {formatStatusLineTokens(stats.outputTokens ?? 0)}
          </Stat>
        )}
        <span className="ms-auto shrink-0 ps-1 @max-[20rem]/dials:hidden">{clock}</span>
      </div>
    </div>
  );
}

function Fact(props: {
  readonly name: string;
  readonly percent?: number;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <span className="text-[11px] text-muted-foreground">{props.name}</span>
      <span className="truncate font-medium">{props.children}</span>
      {props.percent === undefined ? null : (
        <span
          aria-hidden
          className="mt-0.5 h-1 overflow-hidden rounded-full bg-current/20"
          style={{ color: gaugeColor(props.percent) }}
        >
          <span className="block h-full rounded-full bg-current" style={{ width: `${props.percent}%` }} />
        </span>
      )}
    </div>
  );
}

function limitText(limit: StatusLineLimit, nowMs: number): string {
  const left = timeLeft(limit, nowMs);
  return left === null ? `${limit.usedPercent}%` : `${limit.usedPercent}% · resets in ${left}`;
}

/** Everything the strip shows and what it leaves out, written out with names. */
export function StatusDialCard(props: {
  readonly stats: StatusLineStats;
  readonly createdAt: string | null;
}) {
  const { stats } = props;
  const nowMs = useNowMs();
  const startedMs = props.createdAt === null ? Number.NaN : Date.parse(props.createdAt);
  const model = [stats.modelName, stats.effort, stats.fastMode ? "fast" : null].filter(Boolean);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-3 tabular-nums">
      {model.length === 0 ? null : <Fact name="Model">{model.join(" · ")}</Fact>}
      {stats.contextPercent === null ? null : (
        <Fact name="Context" percent={stats.contextPercent}>
          {stats.contextPercent}% · {formatStatusLineTokens(stats.contextTokens ?? 0)}
          {stats.contextMaxTokens === null
            ? null
            : ` of ${formatStatusLineTokens(stats.contextMaxTokens)}`}
        </Fact>
      )}
      {stats.fiveHour === null ? null : (
        <Fact name="5-hour limit" percent={stats.fiveHour.usedPercent}>
          {limitText(stats.fiveHour, nowMs)}
        </Fact>
      )}
      {stats.weekly === null ? null : (
        <Fact name="Weekly limit" percent={stats.weekly.usedPercent}>
          {limitText(stats.weekly, nowMs)}
        </Fact>
      )}
      {Number.isFinite(startedMs) ? (
        <Fact name="Uptime">{formatStatusLineSpan(nowMs - startedMs)}</Fact>
      ) : null}
      {stats.cachePercent === null ? null : <Fact name="Cache hits">{stats.cachePercent}%</Fact>}
      {stats.inputTokens === null ? null : (
        <Fact name="Tokens">
          {formatStatusLineTokens(stats.inputTokens)} in ·{" "}
          {formatStatusLineTokens(stats.outputTokens ?? 0)} out
        </Fact>
      )}
      {stats.cwd === null ? null : <Fact name="Folder">{stats.cwd}</Fact>}
      {stats.version === null ? null : <Fact name="Version">{stats.version}</Fact>}
    </div>
  );
}
