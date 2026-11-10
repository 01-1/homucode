import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  AUTOREVIEW_FINDINGS_MESSAGE_PREFIX,
  MAX_CONSECUTIVE_AUTOREVIEW_WAKES,
  batchHasAgentActivity,
  findingsSection,
  isLgtmReview,
  findingsBody,
  findingsWithout,
  hasSection,
  renderFindingsMessage,
  planAutoreviewBatch,
  planFindingsDelivery,
  renderAutoreviewBatch,
} from "./autoreviewBatch.ts";

const now = DateTime.makeUnsafe("2026-11-09T00:00:00.000Z");
const threadId = ThreadId.make("thread:reviewed");

const base = (id: string, ordinal: number, status: OrchestrationV2TurnItem["status"]) => ({
  id: TurnItemId.make(`turn-item:${id}`),
  threadId,
  runId: RunId.make("run:1"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status,
  title: null,
  startedAt: now,
  completedAt: status === "completed" ? now : null,
  updatedAt: now,
});

const user = (id: string, ordinal: number, text: string, messageId?: string) =>
  ({
    ...base(id, ordinal, "completed"),
    type: "user_message",
    messageId: MessageId.make(messageId ?? `message:${id}`),
    createdBy: "user",
    creationSource: "web",
    inputIntent: "turn_start",
    text,
    attachments: [],
  }) satisfies OrchestrationV2TurnItem;

const assistant = (id: string, ordinal: number, text: string, streaming = false) =>
  ({
    ...base(id, ordinal, streaming ? "running" : "completed"),
    type: "assistant_message",
    messageId: MessageId.make(`message:${id}`),
    text,
    streaming,
  }) satisfies OrchestrationV2TurnItem;

const command = (id: string, ordinal: number, status: OrchestrationV2TurnItem["status"]) =>
  ({
    ...base(id, ordinal, status),
    type: "command_execution",
    input: `run ${id}`,
    output: `output of ${id}`,
    exitCode: 0,
  }) satisfies OrchestrationV2TurnItem;

const fileChange = (id: string, ordinal: number) =>
  ({
    ...base(id, ordinal, "completed"),
    type: "file_change",
    fileName: "src/a.ts",
    diffStr: "@@ -1 +1 @@\n-old\n+new",
    additions: 1,
    deletions: 1,
  }) satisfies OrchestrationV2TurnItem;

const ids = (items: ReadonlyArray<OrchestrationV2TurnItem>) => items.map((item) => item.id);

describe("planAutoreviewBatch", () => {
  it("sends every finished item after the cursor and moves the cursor past them", () => {
    const items = [user("u", 1, "Fix the bug"), assistant("a", 2, "Done"), fileChange("f", 3)];
    const plan = planAutoreviewBatch({ reviewer: { throughOrdinal: -1, sentItemIds: [] }, items });
    assert.deepStrictEqual(ids(plan.items), ids(items));
    assert.equal(plan.throughOrdinal, 3);
    assert.deepStrictEqual(plan.sentItemIds, []);

    const next = planAutoreviewBatch({ reviewer: plan, items });
    assert.deepStrictEqual(next.items, []);
  });

  it("holds a running command back without resending items that finished after it", () => {
    const running = [user("u", 1, "Build it"), command("c", 2, "running"), assistant("a", 3, "Hi")];
    const first = planAutoreviewBatch({
      reviewer: { throughOrdinal: -1, sentItemIds: [] },
      items: running,
    });
    assert.deepStrictEqual(ids(first.items), [
      TurnItemId.make("turn-item:u"),
      TurnItemId.make("turn-item:a"),
    ]);
    assert.equal(first.throughOrdinal, 1);
    assert.deepStrictEqual(first.sentItemIds, [TurnItemId.make("turn-item:a")]);

    const finished = [
      running[0]!,
      command("c", 2, "completed"),
      running[2]!,
      assistant("b", 4, "Next"),
    ];
    const second = planAutoreviewBatch({ reviewer: first, items: finished });
    assert.deepStrictEqual(ids(second.items), [
      TurnItemId.make("turn-item:c"),
      TurnItemId.make("turn-item:b"),
    ]);
    assert.equal(second.throughOrdinal, 4);
    assert.deepStrictEqual(second.sentItemIds, []);
  });

  it("skips streaming text and monitors, and keeps findings without letting them wake a reviewer", () => {
    const findings = user(
      "findings",
      1,
      renderFindingsMessage([findingsSection({ reviewerTitle: "Reviewer A: x", review: "Bug" })]),
      `${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}run:9`,
    );
    const items = [
      findings,
      assistant("streaming", 2, "partial", true),
      { ...command("monitor", 3, "running"), monitor: true },
      assistant("a", 4, "Done"),
    ];
    const plan = planAutoreviewBatch({ reviewer: { throughOrdinal: -1, sentItemIds: [] }, items });
    assert.deepStrictEqual(ids(plan.items), [
      TurnItemId.make("turn-item:findings"),
      TurnItemId.make("turn-item:a"),
    ]);
    assert.isFalse(
      batchHasAgentActivity(
        planAutoreviewBatch({
          reviewer: { throughOrdinal: -1, sentItemIds: [] },
          items: [findings],
        }),
      ),
    );
  });

  it("sends streamed text that finishes after later activity", () => {
    const streaming = [
      user("u", 1, "Explain it"),
      assistant("long", 2, "partial", true),
      command("c", 3, "completed"),
    ];
    const first = planAutoreviewBatch({
      reviewer: { throughOrdinal: -1, sentItemIds: [] },
      items: streaming,
    });
    assert.deepStrictEqual(ids(first.items), [
      TurnItemId.make("turn-item:u"),
      TurnItemId.make("turn-item:c"),
    ]);
    assert.equal(first.throughOrdinal, 1);

    const done = [streaming[0]!, assistant("long", 2, "the full answer"), streaming[2]!];
    const second = planAutoreviewBatch({ reviewer: first, items: done });
    assert.deepStrictEqual(ids(second.items), [TurnItemId.make("turn-item:long")]);
    assert.equal(second.throughOrdinal, 3);
  });

  it("waits for agent activity before waking a reviewer for a lone user message", () => {
    const plan = planAutoreviewBatch({
      reviewer: { throughOrdinal: -1, sentItemIds: [] },
      items: [user("u", 1, "Please start")],
    });
    assert.equal(plan.items.length, 1);
    assert.isFalse(batchHasAgentActivity(plan));
    assert.isTrue(
      batchHasAgentActivity(
        planAutoreviewBatch({
          reviewer: { throughOrdinal: -1, sentItemIds: [] },
          items: [user("u", 1, "Please start"), command("c", 2, "completed")],
        }),
      ),
    );
  });
});

describe("tool calls", () => {
  const tool = (
    id: string,
    ordinal: number,
    status: OrchestrationV2TurnItem["status"],
    input: unknown,
  ) =>
    ({
      ...base(id, ordinal, status),
      type: "dynamic_tool",
      toolName: "watch",
      input,
    }) satisfies OrchestrationV2TurnItem;

  it("leaves out persistent tools, which never finish, so the cursor keeps moving", () => {
    const items = [
      tool("monitor", 1, "running", { persistent: true }),
      tool("send", 2, "completed", { message: "hi" }),
      assistant("a", 3, "Done"),
    ];
    const plan = planAutoreviewBatch({ reviewer: { throughOrdinal: 0, sentItemIds: [] }, items });
    assert.deepStrictEqual(ids(plan.items), [
      TurnItemId.make("turn-item:send"),
      TurnItemId.make("turn-item:a"),
    ]);
    assert.equal(plan.throughOrdinal, 3);
    assert.deepStrictEqual(plan.sentItemIds, []);
  });

  it("cuts long strings in tool input before rendering them", () => {
    const text = renderAutoreviewBatch({
      reviewedThread: { id: threadId, title: "Reviewed" },
      items: [tool("img", 1, "completed", { image: "A".repeat(100_000) })],
      first: false,
    });
    assert.isBelow(text.length, 5_000);
    assert.include(text, "characters omitted");
  });
});

describe("renderAutoreviewBatch", () => {
  const reviewedThread = { id: threadId, title: "Reviewed" };

  it("starts with the review instructions and brief on the first batch only", () => {
    const items = [user("u", 1, "Fix the bug"), fileChange("f", 2)];
    const first = renderAutoreviewBatch({ reviewedThread, items, first: true, brief: "Check SQL" });
    assert.include(first, "You are an autoreviewer");
    assert.include(first, "Review brief: Check SQL");
    assert.include(first, "LGTM");
    assert.include(first, "+new");
    const later = renderAutoreviewBatch({ reviewedThread, items, first: false });
    assert.notInclude(later, "You are an autoreviewer");
    assert.include(later, "since your last batch");
  });

  it("keeps the opening request and the newest items when the backlog is too long", () => {
    const items = [
      user("u", 1, "The original request"),
      ...Array.from({ length: 30 }, (_, index) =>
        assistant(`a${index}`, index + 2, `${index}:${"x".repeat(5_000)}`),
      ),
    ];
    const text = renderAutoreviewBatch({ reviewedThread, items, first: true });
    assert.isAtMost(text.length, 48_000);
    assert.include(text, "The original request");
    assert.include(text, "29:xxx");
    assert.notInclude(text, "\n0:xxx");
    assert.match(text, /\[\d+ earlier items omitted; read them with t3_thread_read/);
  });
});

describe("findings shared between reviewers", () => {
  const reviewedThread = { id: threadId, title: "Reviewed" };
  const ownA = findingsSection({
    reviewerTitle: "Reviewer A: answers (Opus high)",
    review: "a.ts:1 leaks",
  });
  const ownB = findingsSection({ reviewerTitle: "Reviewer B", review: "b.ts:2 races" });
  const message = renderFindingsMessage([ownA, ownB]);

  it("shows the reviewed thread only each reviewer's name line and its text", () => {
    assert.equal(ownA, "Reviewer A:\na.ts:1 leaks");
    assert.equal(ownB, "Reviewer B:\nb.ts:2 races");
    assert.equal(message, "Reviewer A:\na.ts:1 leaks\n\nReviewer B:\nb.ts:2 races");
    assert.equal(findingsBody(findingsWithout(message, ownA)), ownB);
  });

  it("shows a reviewer the others' findings, attributed, and not its own", () => {
    const items = [
      user("f", 1, message, `${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}run:1`),
      assistant("x", 2, "Fixed it"),
    ];
    const forA = renderAutoreviewBatch({
      reviewedThread,
      items,
      first: false,
      ownFindings: [ownA],
    });
    assert.include(forA, "already raised");
    assert.include(forA, "Reviewer B:\nb.ts:2 races");
    assert.notInclude(forA, "a.ts:1 leaks");
    const onlyOwn = renderAutoreviewBatch({
      reviewedThread,
      items: [
        user("g", 1, renderFindingsMessage([ownA]), `${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}run:2`),
        assistant("y", 2, "Next"),
      ],
      first: false,
      ownFindings: [ownA],
    });
    assert.notInclude(onlyOwn, "already raised");
  });

  it("removes only a whole section, never part of a longer one that starts the same", () => {
    const short = findingsSection({ reviewerTitle: "Autoreview", review: "parse.ts:1 drops zero" });
    const long = findingsSection({
      reviewerTitle: "Autoreview",
      review: "parse.ts:1 drops zero and null",
    });
    assert.equal(findingsWithout(renderFindingsMessage([short, long]), short), long);
    assert.equal(findingsWithout(renderFindingsMessage([long, short]), short), long);
    assert.equal(findingsWithout(renderFindingsMessage([long]), short), long);
    assert.isTrue(hasSection(renderFindingsMessage([long, short]), short));
    assert.isFalse(hasSection(renderFindingsMessage([long]), short));
    // A blank line inside a review does not make its first paragraph a section of its own.
    const paragraphs = findingsSection({
      reviewerTitle: "Autoreview",
      review: "parse.ts:1 drops zero\n\n  \nAlso check null.",
    });
    assert.equal(paragraphs, "Autoreview:\nparse.ts:1 drops zero\nAlso check null.");
    assert.isFalse(hasSection(paragraphs, short));
    assert.equal(findingsWithout(renderFindingsMessage([short, paragraphs]), short), paragraphs);
  });

  it("holds a queued findings message back until its turn starts, then sends its final text", () => {
    const queuedRun = RunId.make("run:queued-findings");
    const findingsItem = (text: string) => ({
      ...user("qf", 5, text, `${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}run:qf`),
      runId: queuedRun,
    });
    const reviewer = { throughOrdinal: 4, sentItemIds: [] };
    const waiting = planAutoreviewBatch({
      reviewer,
      items: [findingsItem(ownA), assistant("w", 6, "Working")],
      runs: [{ id: queuedRun, status: "queued" }],
    });
    assert.deepStrictEqual(ids(waiting.items), [TurnItemId.make("turn-item:w")]);
    assert.equal(waiting.throughOrdinal, 4);
    // Another reviewer's findings join the queued message; then its turn starts.
    const started = planAutoreviewBatch({
      reviewer: waiting,
      items: [findingsItem(message), assistant("w", 6, "Working")],
      runs: [{ id: queuedRun, status: "running" }],
    });
    assert.deepStrictEqual(ids(started.items), [TurnItemId.make("turn-item:qf")]);
    assert.include((started.items[0] as { text: string }).text, "b.ts:2 races");
    assert.equal(started.throughOrdinal, 6);
  });

  it("repeats the instructions and the new brief when asked", () => {
    const text = renderAutoreviewBatch({
      reviewedThread,
      items: [assistant("z", 1, "Next")],
      first: false,
      brief: "Only security",
      instructions: true,
    });
    assert.include(text, "You are an autoreviewer");
    assert.include(text, "Review brief: Only security");
    assert.include(text, "since your last batch");
  });
});

describe("custom preamble", () => {
  it("replaces the standard role text and keeps the delivery rule and brief", () => {
    const text = renderAutoreviewBatch({
      reviewedThread: { id: threadId, title: "Reviewed" },
      items: [assistant("p", 1, "Did a thing")],
      first: true,
      brief: "Record new rules",
      preamble: "You are a hook agent. You may edit AGENTS.md and TODO.md.",
    });
    assert.include(text, "You may edit AGENTS.md");
    assert.notInclude(text, "do not edit files");
    assert.include(text, "reply with exactly LGTM");
    assert.include(text, "Review brief: Record new rules");
  });
});

describe("isLgtmReview", () => {
  it("treats a reply that opens with LGTM as nothing to deliver", () => {
    assert.isTrue(isLgtmReview("LGTM"));
    assert.isTrue(isLgtmReview("\n**LGTM.** Nothing to flag."));
    assert.isTrue(isLgtmReview("lgtm - tests cover it"));
    assert.isFalse(isLgtmReview("LGTMs are cheap; but src/a.ts:3 drops the error"));
    assert.isFalse(isLgtmReview("1. src/a.ts:3 drops the error. Otherwise LGTM"));
    assert.isFalse(isLgtmReview(""));
  });
});

describe("planFindingsDelivery", () => {
  const run = (
    ordinal: number,
    status: OrchestrationV2Run["status"],
    userMessageId = `message:user:${ordinal}`,
    extra: Partial<OrchestrationV2Run> = {},
  ): OrchestrationV2Run => ({
    id: RunId.make(`run:${ordinal}`),
    threadId,
    ordinal,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
    providerThreadId: null,
    userMessageId: MessageId.make(userMessageId),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
    ...extra,
  });
  const findings = (ordinal: number) =>
    run(ordinal, "completed", `${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}${ordinal}`);

  it("steers the running turn", () => {
    assert.deepStrictEqual(planFindingsDelivery([run(1, "completed"), run(2, "running")]), {
      type: "steer",
      targetRunId: RunId.make("run:2"),
    });
  });

  it("joins the findings message already waiting instead of queueing another", () => {
    assert.deepStrictEqual(
      planFindingsDelivery([
        run(1, "completed"),
        run(2, "queued", `${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}x`),
        run(3, "queued"),
      ]),
      { type: "append", queuedRunId: RunId.make("run:2") },
    );
  });

  it("queues behind queued work, held or not", () => {
    assert.deepStrictEqual(
      planFindingsDelivery([
        run(1, "cancelled"),
        run(2, "queued", "message:q", { queueHeld: true }),
      ]),
      { type: "queue" },
    );
  });

  it("waits for the next turn after a Stop instead of restarting the thread", () => {
    assert.equal(planFindingsDelivery([run(1, "completed"), run(2, "interrupted")]).type, "skip");
    // A Stop that reached a turn as it completed leaves it completed.
    assert.equal(planFindingsDelivery([run(1, "completed")], true).type, "skip");
    // Still stopping: no steer into the run being stopped.
    assert.equal(planFindingsDelivery([run(1, "running")], true).type, "skip");
    // A queued message cancelled before it started does not hide the stopped run.
    assert.equal(
      planFindingsDelivery([
        run(1, "interrupted"),
        run(2, "cancelled", "message:q", { startedAt: null }),
      ]).type,
      "skip",
    );
    assert.deepStrictEqual(planFindingsDelivery([run(1, "interrupted"), run(2, "running")]), {
      type: "steer",
      targetRunId: RunId.make("run:2"),
    });
    assert.deepStrictEqual(planFindingsDelivery([run(1, "interrupted"), run(2, "completed")]), {
      type: "start",
    });
  });

  it("starts a turn on an idle thread until findings started too many in a row", () => {
    assert.deepStrictEqual(planFindingsDelivery([run(1, "completed")]), { type: "start" });
    const streak = Array.from({ length: MAX_CONSECUTIVE_AUTOREVIEW_WAKES }, (_, index) =>
      findings(index + 2),
    );
    assert.equal(planFindingsDelivery([run(1, "completed"), ...streak]).type, "skip");
    // A user message in between resets the streak.
    assert.deepStrictEqual(
      planFindingsDelivery([...streak, run(MAX_CONSECUTIVE_AUTOREVIEW_WAKES + 2, "completed")]),
      { type: "start" },
    );
  });
});
