import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  groupMadoHomuThreads,
  reorderMadoHomuThreads,
  type MadoHomuGroup,
  type MadoHomuGroupKind,
} from "@t3tools/client-runtime/madohomu";
import type { EnvironmentId, ServerSettings, ThreadId } from "@t3tools/contracts";

import {
  buildThreadListV2ListItems,
  resolveThreadListV2WokeAt,
  type ThreadListV2ThreadListItem,
} from "../threads/threadListV2";

type MadoHomuListSettings = Pick<
  ServerSettings,
  "madohomuThreads" | "madohomuSections" | "madohomuThreadOrder"
>;

export interface MadoHomuSectionRow {
  readonly type: "section";
  readonly key: string;
  readonly kind: MadoHomuGroupKind;
  readonly id: string;
  readonly title: string;
  readonly count: number;
  /** Null for sections that do not collapse. */
  readonly expanded: boolean | null;
}

export interface MadoHomuEmptyRow {
  readonly type: "empty";
  readonly key: string;
  readonly kind: MadoHomuGroupKind;
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

export type MadoHomuListRow = MadoHomuSectionRow | MadoHomuEmptyRow | MadoHomuThreadRow;

const COLLAPSIBLE: ReadonlySet<MadoHomuGroupKind> = new Set(["snoozed", "settled"]);
const ALWAYS_SHOWN: ReadonlySet<MadoHomuGroupKind> = new Set(["pinned", "custom"]);

/** The MadoHomu screen's rows: a header per section, then its threads as home-list rows. */
export function buildMadoHomuListRows(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly settings: MadoHomuListSettings;
  readonly now: string;
  /** Collapsible sections the user opened; Snoozed and Settled start collapsed. */
  readonly expanded: ReadonlySet<string>;
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys?: ReadonlySet<string>;
}): MadoHomuListRow[] {
  const rows: MadoHomuListRow[] = [];
  for (const group of groupMadoHomuThreads(input.threads, input.settings, { now: input.now })) {
    if (group.threads.length === 0 && !ALWAYS_SHOWN.has(group.kind)) continue;
    const collapsible = COLLAPSIBLE.has(group.kind);
    const expanded = collapsible ? input.expanded.has(group.id) : null;
    rows.push({
      type: "section",
      key: `section:${group.id}`,
      kind: group.kind,
      id: group.id,
      title: group.title,
      count: group.threads.length,
      expanded,
    });
    if (expanded === false) continue;
    if (group.threads.length === 0) {
      rows.push({ type: "empty", key: `empty:${group.id}`, kind: group.kind });
      continue;
    }
    const manual = ALWAYS_SHOWN.has(group.kind);
    const items = buildThreadListV2ListItems({
      items: group.threads.map((thread, index) => ({
        thread,
        variant: group.kind === "settled" ? ("slim" as const) : ("card" as const),
        snoozed: group.kind === "snoozed",
        pinned: false,
        wokeAt:
          group.kind === "settled" ? null : resolveThreadListV2WokeAt(thread, { now: input.now }),
        isLast: index === group.threads.length - 1,
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
  }
  return rows;
}

/** Pinned and custom-section threads in the order they are shown. */
function manualOrder<T extends { readonly id: ThreadId }>(
  groups: ReadonlyArray<MadoHomuGroup<T>>,
): ThreadId[] {
  return groups
    .filter((group) => ALWAYS_SHOWN.has(group.kind))
    .flatMap((group) => group.threads.map((thread) => thread.id));
}

/**
 * The new `madohomuThreadOrder` after moving a pinned thread one place up or down
 * within its section, or null when it cannot move that way.
 */
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
  const order = manualOrder(groups);
  if (input.direction === "up") {
    const before = group.threads[index - 1];
    return before ? reorderMadoHomuThreads(order, input.threadId, before.id) : null;
  }
  const next = group.threads[index + 1];
  if (!next) return null;
  return reorderMadoHomuThreads(order, input.threadId, order[order.indexOf(next.id) + 1] ?? null);
}
