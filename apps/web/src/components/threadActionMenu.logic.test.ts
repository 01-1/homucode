import { describe, expect, it } from "vite-plus/test";

import { ThreadId } from "@t3tools/contracts";

import {
  buildMoveEnvironmentOptions,
  buildThreadActionMenuItems,
  hasRunningSubagents,
  moveParentFromMenuId,
  parseMoveToEnvironmentProjectMenuId,
  resolveThreadMoveOptions,
  type ThreadActionMenuState,
} from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it("offers project moves while working and enforces operation permission", () => {
    const state = {
      ...baseState,
      isRunning: true,
      moveProjectOptions: [{ id: "destination", title: "Destination" }],
    };
    const move = buildThreadActionMenuItems(state).find((item) => item.id === "move-to-project");
    expect(move?.disabled).not.toBe(true);
    expect(move?.children?.map((item) => item.id)).toEqual([
      "move-to-project:destination",
      "move-to-new-project",
    ]);
    const elsewhere = buildThreadActionMenuItems({
      ...state,
      moveEnvironmentOptions: buildMoveEnvironmentOptions({
        sourceEnvironmentId: "here",
        projects: [
          { environmentId: "here", id: "local", title: "Local" },
          { environmentId: "laptop", id: "app", title: "App" },
          { environmentId: "laptop", id: "old", title: "Old", archivedAt: "2026-01-01" },
          { environmentId: "viewer", id: "docs", title: "Docs" },
        ],
        environmentLabel: (environmentId) => (environmentId === "laptop" ? "Laptop" : null),
        canOperate: (environmentId) => environmentId !== "viewer",
      }),
    }).find((item) => item.id === "move-to-project");
    const laptop = elsewhere?.children?.at(-1);
    // Running threads cannot be archived, which the cross-environment move ends with.
    expect(laptop).toMatchObject({ label: "On Laptop", disabled: true });
    expect(laptop?.children?.map((item) => parseMoveToEnvironmentProjectMenuId(item.id))).toEqual([
      { environmentId: "laptop", projectId: "app" },
    ]);
    const denied = buildThreadActionMenuItems({ ...state, canOperate: false }).find(
      (item) => item.id === "move-to-project",
    );
    expect(denied?.disabled).toBe(true);
    expect(denied?.children?.[0]?.disabled).toBe(true);
  });

  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("places the folder menu after the snooze group and disables it without permission", () => {
    const folderMenu = {
      id: "folder" as const,
      label: "Move to folder",
      children: [{ id: "folder:new" as const, label: "New folder…" }],
    };
    const ids = (canOperate: boolean, menu: typeof folderMenu | null) =>
      buildThreadActionMenuItems({ ...baseState, canOperate, folderMenu: menu });
    const items = ids(true, folderMenu).map((item) => item.id);
    expect(items.slice(items.indexOf("snooze"), items.indexOf("rename") + 1)).toEqual([
      "snooze",
      "folder",
      "rename",
    ]);
    expect(ids(true, null).some((item) => item.id === "folder")).toBe(false);
    const locked = ids(false, folderMenu).find((item) => item.id === "folder");
    expect(locked?.disabled).toBe(true);
    expect(locked?.children?.every((child) => child.disabled)).toBe(true);
  });

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });
});

describe("resolveThreadMoveOptions", () => {
  type Lineage = Parameters<typeof resolveThreadMoveOptions>[0]["lineage"];
  const thread = (
    id: string,
    lineage: Partial<Lineage> = {},
    overrides: Partial<Parameters<typeof resolveThreadMoveOptions>[0]> = {},
  ) => ({
    id: ThreadId.make(id),
    environmentId: "environment",
    projectId: "project",
    title: id,
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    lineage: { parentThreadId: null, relationshipToParent: null, ...lineage },
    latestRun: {},
    source: { creationSource: "web" as const },
    ...overrides,
  });
  const subagentOf = (parent: string) => ({
    parentThreadId: ThreadId.make(parent),
    relationshipToParent: "subagent" as const,
  });
  const root = thread("root", {}, { updatedAt: "2026-01-03T00:00:00.000Z" });
  const other = thread("other", {}, { updatedAt: "2026-01-02T00:00:00.000Z" });
  const child = thread("child", subagentOf("root"));
  const grandchild = thread("grandchild", subagentOf("child"));
  const threads = [
    root,
    other,
    child,
    grandchild,
    thread("never-ran", {}, { latestRun: null }),
    thread("archived", {}, { archivedAt: "2026-01-01T00:00:00.000Z" }),
    thread("elsewhere", {}, { projectId: "project-other" }),
    thread("side-chat", { parentThreadId: ThreadId.make("root"), sideChat: true }),
    thread("native", subagentOf("root"), { source: { creationSource: "provider" } }),
  ];
  const ids = (options: ReturnType<typeof resolveThreadMoveOptions>) =>
    options?.candidates.map((candidate) => candidate.threadId);

  it("offers root to subagents and the same project's threads that can take a subagent", () => {
    expect(resolveThreadMoveOptions(child, threads)?.canMoveToRoot).toBe(true);
    // Not itself, its own parent, or anything below it.
    expect(ids(resolveThreadMoveOptions(child, threads))).toEqual(["other"]);
    expect(resolveThreadMoveOptions(root, threads)).toMatchObject({ canMoveToRoot: false });
    expect(ids(resolveThreadMoveOptions(root, threads))).toEqual(["other"]);
    expect(ids(resolveThreadMoveOptions(other, threads))).toEqual(["root", "child", "grandchild"]);
  });

  it("does not move side chats, provider-native subagents or delegated tasks", () => {
    expect(resolveThreadMoveOptions(threads[7]!, threads)).toBeNull();
    expect(resolveThreadMoveOptions(threads[8]!, threads)).toBeNull();
    expect(resolveThreadMoveOptions({ ...child, delegatedFrom: {} }, threads)).toBeNull();
  });

  it("puts the moves in the menu and reads them back", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      move: resolveThreadMoveOptions(child, threads),
    });
    expect(items.find((item) => item.id === "move-to-root")).toBeDefined();
    const under = items.find((item) => item.id === "move-under");
    expect(under?.children?.map((item) => item.id)).toEqual(["move-under:other"]);
    expect(moveParentFromMenuId("move-under:other")).toBe("other");
    expect(moveParentFromMenuId("move-to-root")).toBeNull();
    expect(moveParentFromMenuId("pin")).toBeUndefined();
    expect(
      buildThreadActionMenuItems({ ...baseState, canOperate: false, move: null }).some((item) =>
        item.id.startsWith("move"),
      ),
    ).toBe(false);
  });
});

describe("Stop with subagents", () => {
  const parentId = ThreadId.make("parent");
  const thread = (
    id: string,
    parentThreadId: ThreadId | null,
    relationshipToParent: "fork" | "subagent" | null,
    running: boolean,
  ) => ({ id, running, lineage: { parentThreadId, relationshipToParent } });

  it("finds running subagents directly under the thread only", () => {
    const isRunning = (candidate: { readonly running: boolean }) => candidate.running;
    expect(
      hasRunningSubagents(parentId, [thread("a", parentId, "subagent", true)], isRunning),
    ).toBe(true);
    expect(
      hasRunningSubagents(
        parentId,
        [
          thread("idle", parentId, "subagent", false),
          thread("fork", parentId, "fork", true),
          thread("elsewhere", ThreadId.make("other"), "subagent", true),
        ],
        isRunning,
      ),
    ).toBe(false);
  });

  it("is offered only while subagents are running", () => {
    expect(
      buildThreadActionMenuItems(baseState).some((item) => item.id === "stop-with-subagents"),
    ).toBe(false);
    expect(
      buildThreadActionMenuItems({ ...baseState, hasRunningSubagents: true }).find(
        (item) => item.id === "stop-with-subagents",
      )?.label,
    ).toBe("Stop with subagents");
  });
});
