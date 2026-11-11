import {
  isProviderNativeSubagentThread,
  type ContextMenuItem,
  type ThreadId,
} from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

export type ThreadActionMenuId =
  | "find"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "share-guest"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "stop-with-subagents"
  | "move-to-new-project"
  | "move-to-project"
  | `move-to-project:${string}`
  | "move-to-root"
  | "move-under"
  | `move-under:${string}`
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(options: {
  readonly hasPath: boolean;
  readonly hasBranch: boolean;
  readonly hasProject: boolean;
}): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath ? [{ id: "copy-path" as const, label: "Path", icon: "folder" }] : []),
        ...(options.hasBranch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
      ],
    },
    ...(options.hasProject
      ? [{ id: "project-settings" as const, label: "Project settings", icon: "settings" }]
      : []),
    {
      id: "discard",
      label: "Discard draft",
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
  /** Where the thread can be re-parented to, or null when it cannot move. */
  readonly move?: ThreadMoveOptions | null;
  /** The thread has running subagents, which plain Stop leaves running. */
  readonly moveProjectOptions?: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly hasRunningSubagents?: boolean;
}

/** Whether any subagent thread directly under `threadId` is still running. */
export function hasRunningSubagents<
  T extends {
    readonly lineage: {
      readonly parentThreadId: ThreadId | null;
      readonly relationshipToParent: "fork" | "subagent" | null;
    };
  },
>(threadId: ThreadId, threads: ReadonlyArray<T>, isRunning: (thread: T) => boolean): boolean {
  return threads.some(
    (candidate) =>
      candidate.lineage.parentThreadId === threadId &&
      candidate.lineage.relationshipToParent === "subagent" &&
      isRunning(candidate),
  );
}

export interface ThreadMoveOptions {
  readonly canMoveToRoot: boolean;
  readonly candidates: ReadonlyArray<{ readonly threadId: ThreadId; readonly title: string }>;
}

type MovableThread = {
  readonly id: ThreadId;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
  readonly lineage: {
    readonly parentThreadId: ThreadId | null;
    readonly relationshipToParent: "fork" | "subagent" | null;
    readonly sideChat?: boolean | undefined;
  };
  readonly delegatedFrom?: unknown;
  readonly latestRun: unknown;
  readonly source: {
    readonly creationSource: Parameters<typeof isProviderNativeSubagentThread>[0]["creationSource"];
  };
};

const isNativeSubagent = (thread: MovableThread) =>
  isProviderNativeSubagentThread({
    lineage: { ...thread.lineage, rootThreadId: thread.id },
    creationSource: thread.source.creationSource,
  });

/**
 * The server's `thread.move` rules, so the menu offers only moves it accepts: side chats,
 * provider-native subagents and tasks from linked environments stay put, and a thread moves
 * under a thread of its own project that has run, is not its parent, and is not below it.
 */
export function resolveThreadMoveOptions(
  thread: MovableThread,
  threads: ReadonlyArray<MovableThread>,
  limit = 15,
): ThreadMoveOptions | null {
  if (
    thread.archivedAt !== null ||
    thread.lineage.sideChat === true ||
    thread.delegatedFrom != null ||
    isNativeSubagent(thread)
  ) {
    return null;
  }
  const sameScope = threads.filter(
    (candidate) =>
      candidate.environmentId === thread.environmentId && candidate.projectId === thread.projectId,
  );
  const byId = new Map(sameScope.map((candidate) => [candidate.id, candidate] as const));
  const isBelowThread = (candidate: MovableThread) => {
    const visited = new Set<ThreadId>();
    let current: MovableThread | undefined = candidate;
    while (current !== undefined && current.lineage.parentThreadId !== null) {
      if (current.lineage.parentThreadId === thread.id) return true;
      if (visited.has(current.id)) return false;
      visited.add(current.id);
      current = byId.get(current.lineage.parentThreadId);
    }
    return false;
  };
  const currentParentId =
    thread.lineage.relationshipToParent === "subagent" ? thread.lineage.parentThreadId : null;
  const candidates = sameScope
    .filter(
      (candidate) =>
        candidate.id !== thread.id &&
        candidate.id !== currentParentId &&
        candidate.archivedAt === null &&
        candidate.latestRun != null &&
        candidate.lineage.sideChat !== true &&
        !isNativeSubagent(candidate) &&
        !isBelowThread(candidate),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map((candidate) => ({ threadId: candidate.id, title: candidate.title }));
  return { canMoveToRoot: currentParentId !== null, candidates };
}

/** The new parent a move menu id asks for: a thread, `null` for root, or undefined if not a move. */
export function moveParentFromMenuId(id: string): ThreadId | null | undefined {
  if (id === "move-to-root") return null;
  return id.startsWith("move-under:") ? (id.slice("move-under:".length) as ThreadId) : undefined;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: "Find in thread", icon: "text-search" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: `New thread on ${state.branch}`,
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: "Unpin thread", icon: "pin-off" }
            : { id: "pin" as const, label: "Pin thread", icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? { id: "unsettle" as const, label: "Un-settle thread", icon: "circle-check" }
            : { id: "settle" as const, label: "Settle thread", icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: "Wake thread", icon: "clock" }
            : {
                id: "snooze" as const,
                label: "Snooze",
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: "Custom…",
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    { id: "rename", label: "Rename thread", icon: "pencil", separatorBefore: true },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: "Mark unread", icon: "mail-open" },
    ...(state.canShareWithGuest
      ? [{ id: "share-guest" as const, label: "Share with guest", icon: "user-plus" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? "Show all projects"
              : `Filter by ${state.projectFilter.label}`,
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: "Turn into project",
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.moveProjectOptions !== undefined
      ? [
          {
            id: "move-to-project" as const,
            label: "Move to project",
            icon: "folder" as const,
            children: [
              ...state.moveProjectOptions.map((project) => ({
                id: `move-to-project:${project.id}` as const,
                label: project.title,
              })),
              { id: "move-to-new-project" as const, label: "New project…" },
            ],
          },
        ]
      : []),
    ...(state.hasRunningSubagents === true
      ? [{ id: "stop-with-subagents" as const, label: "Stop with subagents" }]
      : []),
    ...(state.move?.canMoveToRoot === true
      ? [{ id: "move-to-root" as const, label: "Move to root" }]
      : []),
    ...(state.move != null && state.move.candidates.length > 0
      ? [
          {
            id: "move-under" as const,
            label: "Move under",
            icon: "folder-tree",
            children: state.move.candidates.map((candidate) => ({
              id: `move-under:${candidate.threadId}` as const,
              label: candidate.title,
            })),
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: "Auto-settle behavior",
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: "Enabled",
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: "Disabled",
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: "Path", icon: "folder" },
        ...(state.branch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
        { id: "copy-thread", label: "Thread", icon: "message-square" },
        { id: "copy-thread-id", label: "Thread ID", icon: "hash" },
      ],
    },
    { id: "project-settings", label: "Project settings", icon: "settings" },
    {
      id: "archive",
      label: "Archive thread",
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
