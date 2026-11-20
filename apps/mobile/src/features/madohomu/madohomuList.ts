import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import {
  groupMadoHomuThreads,
  isMadoHomuThreadPinned,
  MADOHOMU_SCRATCH_PAGE,
  moveMadoHomuThreadsLast,
  pageMadoHomuRows,
  reorderMadoHomuThreads,
  type MadoHomuGroup,
  type MadoHomuGroupKind,
} from "@t3tools/client-runtime/madohomu";
import type {
  EnvironmentId,
  MadoHomuThreadSettings,
  ServerSettings,
  ServerSettingsPatch,
  ThreadId,
} from "@t3tools/contracts";

import {
  buildThreadListV2ListItems,
  resolveThreadListV2Status,
  resolveThreadListV2WokeAt,
  type ThreadListV2ThreadListItem,
} from "../threads/threadListV2";

import type { MessageResolver } from "../../i18n/messages";

type MadoHomuListSettings = Pick<
  ServerSettings,
  "madohomuThreads" | "madohomuSections" | "madohomuThreadOrder" | "madohomuWorkingPlacement"
>;

export interface MadoHomuSectionRow {
  readonly type: "section";
  readonly key: string;
  readonly kind: MadoHomuGroupKind;
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly countIsPartial: boolean;
  /** Null where the section cannot collapse right now (manual sections in Reorder mode). */
  readonly expanded: boolean | null;
  /** Rows needing the user that a collapsed section hides; 0 when expanded. */
  readonly attention: number;
}

export interface MadoHomuEmptyRow {
  readonly type: "empty";
  readonly key: string;
  readonly kind: MadoHomuGroupKind;
}

export type MadoHomuMoreRow = {
  readonly type: "more";
  readonly key: string;
} & (
  | { readonly kind: "scratch"; readonly count: number }
  | { readonly kind: "settled"; readonly count: number | null }
);

export interface MadoHomuThreadRow {
  readonly type: "thread";
  readonly key: string;
  readonly kind: MadoHomuGroupKind;
  readonly sectionId: string;
  readonly row: ThreadListV2ThreadListItem;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

export type MadoHomuListRow =
  | MadoHomuSectionRow
  | MadoHomuEmptyRow
  | MadoHomuMoreRow
  | MadoHomuThreadRow;

const COLLAPSED_BY_DEFAULT: ReadonlySet<MadoHomuGroupKind> = new Set(["snoozed", "settled"]);
const ALWAYS_SHOWN: ReadonlySet<MadoHomuGroupKind> = new Set(["pinned", "custom"]);

/** Whether a thread's row shows it waiting on the user: an approval, a question or a guest. */
function madohomuNeedsUser(thread: EnvironmentThreadShell): boolean {
  const status = resolveThreadListV2Status(thread);
  return status === "approval" || status === "input" || status === "request";
}

export function buildMadoHomuListRows(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settings: MadoHomuListSettings;
  readonly now: string;
  /** Ids of sections the user flipped from their default (open, or closed for Snoozed/Settled). */
  readonly toggled: ReadonlySet<string>;
  /** How many Scratch rows show before "Show more". */
  readonly scratchCount?: number;
  readonly settledLimit: number;
  readonly isListedSettled: (thread: EnvironmentThreadShell) => boolean;
  readonly settledHistory: {
    /** Unfiltered history only determines whether to offer the shelf. */
    readonly totalCount: number;
    readonly status: "complete" | "pageable" | "unavailable";
  };
  /** Reorder mode: Pinned and custom sections stay open so every drop target shows. */
  readonly keepManualOpen?: boolean;
  readonly resolve?: MessageResolver;
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys?: ReadonlySet<string>;
  readonly isWorking?: (thread: EnvironmentThreadShell) => boolean;
}): MadoHomuListRow[] {
  const rows: MadoHomuListRow[] = [];
  const { isWorking } = input;
  const groups = groupMadoHomuThreads(input.threads, input.settings, {
    now: input.now,
    ...(input.resolve ? { resolve: input.resolve } : {}),
    // A thread waiting on the user, a guest's request included, is never "working".
    ...(isWorking
      ? {
          isWorking: (thread: EnvironmentThreadShell) =>
            !madohomuNeedsUser(thread) && isWorking(thread),
        }
      : {}),
  });
  for (const group of groups) {
    const history = group.kind === "settled" ? input.settledHistory : null;
    const count = group.threads.length;
    const canPage = history?.status === "pageable";
    const countIsPartial = canPage || history?.status === "unavailable";
    if (count === 0 && !ALWAYS_SHOWN.has(group.kind) && !history?.totalCount && !countIsPartial)
      continue;
    const manual = ALWAYS_SHOWN.has(group.kind);
    const expanded =
      manual && input.keepManualOpen
        ? null
        : COLLAPSED_BY_DEFAULT.has(group.kind) === input.toggled.has(group.id);
    rows.push({
      type: "section",
      key: `section:${group.id}`,
      kind: group.kind,
      id: group.id,
      title: group.title,
      count,
      countIsPartial,
      expanded,
      attention: expanded === false ? group.threads.filter(madohomuNeedsUser).length : 0,
    });
    if (expanded === false) continue;
    if (count === 0 && !canPage) {
      rows.push({ type: "empty", key: `empty:${group.id}`, kind: group.kind });
      continue;
    }
    const shown =
      group.kind === "scratch"
        ? pageMadoHomuRows(
            group.threads,
            input.scratchCount ?? MADOHOMU_SCRATCH_PAGE,
            madohomuNeedsUser,
          ).shown
        : group.kind === "settled"
          ? sortSettledThreads(
              canPage ? group.threads.filter(input.isListedSettled) : group.threads,
            ).slice(0, input.settledLimit)
          : group.threads;
    const items = buildThreadListV2ListItems({
      items: shown.map((thread, index) => ({
        thread,
        variant: group.kind === "settled" ? ("slim" as const) : ("card" as const),
        snoozed: group.kind === "snoozed",
        // MadoHomu's own pin is its section; T3 Code's pin glyph would read as that.
        pinned: false,
        wokeAt:
          group.kind === "settled" ? null : resolveThreadListV2WokeAt(thread, { now: input.now }),
        isLast: index === shown.length - 1,
      })),
      pendingTasks: [],
      snoozeLabelNow: input.now,
      ...(input.snoozeEnvironmentIds ? { snoozeEnvironmentIds: input.snoozeEnvironmentIds } : {}),
      ...(input.queuedThreadKeys ? { queuedThreadKeys: input.queuedThreadKeys } : {}),
    });
    items.forEach((item, index) => {
      if (item.type !== "v2-thread") return;
      rows.push({
        type: "thread",
        key: item.key,
        kind: group.kind,
        sectionId: group.id,
        row: item,
        canMoveUp: manual && index > 0,
        canMoveDown: manual && index < items.length - 1,
      });
    });
    if (group.kind === "scratch" && shown.length < count) {
      rows.push({
        type: "more",
        key: `more:${group.id}`,
        kind: group.kind,
        count: count - shown.length,
      });
    } else if (group.kind === "settled" && (canPage || shown.length < count)) {
      rows.push({
        type: "more",
        key: `more:${group.id}`,
        kind: "settled",
        count: countIsPartial ? null : count - shown.length,
      });
    }
  }
  return rows;
}

// Keeps the saved positions of pinned threads that are snoozed or settled right now.
function manualOrder<T extends { readonly id: ThreadId }>(
  groups: ReadonlyArray<MadoHomuGroup<T>>,
  saved: ReadonlyArray<ThreadId>,
): ThreadId[] {
  const listed = new Set(saved);
  const unlisted = groups
    .filter((group) => ALWAYS_SHOWN.has(group.kind))
    .flatMap((group) => group.threads.map((thread) => thread.id))
    .filter((id) => !listed.has(id));
  return [...unlisted, ...saved];
}

export function moveMadoHomuThread(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settings: MadoHomuListSettings;
  readonly now: string;
  readonly threadId: ThreadId;
  readonly direction: "up" | "down";
}): ThreadId[] | null {
  const groups = groupMadoHomuThreads(input.threads, input.settings, { now: input.now });
  const group = groups.find(
    (candidate) =>
      ALWAYS_SHOWN.has(candidate.kind) &&
      candidate.threads.some((thread) => thread.id === input.threadId),
  );
  if (!group) return null;
  const index = group.threads.findIndex((thread) => thread.id === input.threadId);
  const order = manualOrder(groups, input.settings.madohomuThreadOrder);
  if (input.direction === "up") {
    const before = group.threads[index - 1];
    return before ? reorderMadoHomuThreads(order, input.threadId, before.id) : null;
  }
  const next = group.threads[index + 1];
  if (!next) return null;
  return reorderMadoHomuThreads(order, input.threadId, order[order.indexOf(next.id) + 1] ?? null);
}

export interface MadoHomuDrop {
  readonly order: ThreadId[];
  /** The custom section the thread lands in; null is Pinned. */
  readonly section: string | null;
}

/** Drops a pinned thread at `index` of Pinned or a custom section, counted without the thread. */
export function dropMadoHomuThread(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settings: MadoHomuListSettings;
  readonly now: string;
  readonly threadId: ThreadId;
  readonly sectionId: string;
  readonly index: number;
}): MadoHomuDrop | null {
  const groups = groupMadoHomuThreads(input.threads, input.settings, { now: input.now });
  const manual = groups.filter((group) => ALWAYS_SHOWN.has(group.kind));
  const from = manual.find((group) => group.threads.some((thread) => thread.id === input.threadId));
  const to = manual.find((group) => group.id === input.sectionId);
  if (!from || !to) return null;
  const at = from.threads.findIndex((thread) => thread.id === input.threadId);
  if (from === to && at === input.index) return null;
  const others = to.threads.filter((thread) => thread.id !== input.threadId);
  const order = manualOrder(groups, input.settings.madohomuThreadOrder);
  const rest = order.filter((id) => id !== input.threadId);
  const before = others[input.index];
  const last = others.at(-1);
  return {
    // An empty section has no neighbours to sit between, so the thread keeps its saved place.
    order: before
      ? reorderMadoHomuThreads(order, input.threadId, before.id)
      : last
        ? reorderMadoHomuThreads(order, input.threadId, rest[rest.indexOf(last.id) + 1] ?? null)
        : order,
    section: to.kind === "custom" ? to.id : null,
  };
}

export function madohomuDropPatch(
  settings: Pick<ServerSettings, "madohomuThreads">,
  threadId: ThreadId,
  drop: MadoHomuDrop,
) {
  const entry: MadoHomuThreadSettings = {
    ...(settings.madohomuThreads[threadId] ?? { icon: null, prompt: "" }),
    pinned: true,
    section: drop.section,
  };
  return {
    madohomuThreadOrder: drop.order,
    madohomuThreads: { [threadId]: entry } as Record<ThreadId, MadoHomuThreadSettings>,
  };
}

/**
 * Files a thread in Pinned or a custom section (`null` is Scratch). A thread that changes place
 * goes to the end of its new section, as on web.
 */
export function madohomuPlacePatch(
  settings: Pick<ServerSettings, "madohomuThreads" | "madohomuThreadOrder">,
  threadId: ThreadId,
  place: { readonly section: string | null } | null,
): ServerSettingsPatch {
  const saved = settings.madohomuThreads[threadId];
  const entry = saved ?? { icon: null, prompt: "" };
  if (place === null) {
    return { madohomuThreads: { [threadId]: { ...entry, pinned: false, section: null } } };
  }
  const unchanged = isMadoHomuThreadPinned(saved) && (entry.section ?? null) === place.section;
  return {
    madohomuThreads: { [threadId]: { ...entry, pinned: true, section: place.section } },
    ...(unchanged
      ? {}
      : {
          madohomuThreadOrder: moveMadoHomuThreadsLast(
            settings.madohomuThreadOrder,
            [threadId],
            [threadId],
          ),
        }),
  };
}
