import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  groupMadoHomuThreads,
  MADOHOMU_SCRATCH_PAGE,
  pageMadoHomuRows,
  reorderMadoHomuThreads,
  type MadoHomuGroup,
  type MadoHomuGroupKind,
} from "@t3tools/client-runtime/madohomu";
import type {
  EnvironmentId,
  MadoHomuThreadSettings,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";

import {
  buildThreadListV2ListItems,
  resolveThreadListV2WokeAt,
  type ThreadListV2ThreadListItem,
} from "../threads/threadListV2";

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

export interface MadoHomuMoreRow {
  readonly type: "more";
  readonly key: string;
  readonly count: number;
}

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

/** Whether a thread waits on the user: an approval or a question. */
function madohomuNeedsUser(
  thread: Pick<EnvironmentThreadShell, "hasPendingApprovals" | "hasPendingUserInput">,
): boolean {
  return thread.hasPendingApprovals || thread.hasPendingUserInput;
}

export function buildMadoHomuListRows(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settings: MadoHomuListSettings;
  readonly now: string;
  /** Ids of sections the user flipped from their default (open, or closed for Snoozed/Settled). */
  readonly toggled: ReadonlySet<string>;
  /** How many Scratch rows show before "Show more". */
  readonly scratchCount?: number;
  /** Reorder mode: Pinned and custom sections stay open so every drop target shows. */
  readonly keepManualOpen?: boolean;
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys?: ReadonlySet<string>;
  readonly isWorking?: (thread: EnvironmentThreadShell) => boolean;
}): MadoHomuListRow[] {
  const rows: MadoHomuListRow[] = [];
  const groups = groupMadoHomuThreads(input.threads, input.settings, {
    now: input.now,
    ...(input.isWorking ? { isWorking: input.isWorking } : {}),
  });
  for (const group of groups) {
    if (group.threads.length === 0 && !ALWAYS_SHOWN.has(group.kind)) continue;
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
      count: group.threads.length,
      expanded,
      attention: expanded === false ? group.threads.filter(madohomuNeedsUser).length : 0,
    });
    if (expanded === false) continue;
    if (group.threads.length === 0) {
      // An empty custom section shows only its heading.
      if (group.kind === "pinned") {
        rows.push({ type: "empty", key: `empty:${group.id}`, kind: group.kind });
      }
      continue;
    }
    const { shown, more } =
      group.kind === "scratch"
        ? pageMadoHomuRows(
            group.threads,
            input.scratchCount ?? MADOHOMU_SCRATCH_PAGE,
            madohomuNeedsUser,
          )
        : { shown: group.threads, more: 0 };
    const items = buildThreadListV2ListItems({
      items: shown.map((thread, index) => ({
        thread,
        variant: group.kind === "settled" ? ("slim" as const) : ("card" as const),
        snoozed: group.kind === "snoozed",
        pinned: thread.pinnedAt != null,
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
    if (more > 0) {
      rows.push({
        type: "more",
        key: `more:${group.id}`,
        count: more,
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
