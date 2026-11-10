import {
  CommandId,
  MessageId,
  type ModelSelection,
  type NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Autoreviewer,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type ProviderInteractionMode,
  type RunId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import {
  AUTOREVIEW_BATCH_MESSAGE_PREFIX,
  AUTOREVIEW_FINDINGS_MESSAGE_PREFIX,
  AUTOREVIEW_REVIEWABLE_TYPES,
  batchHasAgentActivity,
  isLgtmReview,
  isReviewableItem,
  isTerminalItem,
  planAutoreviewBatch,
  findingsSection,
  batchHasToolCall,
  batchHasUserMessage,
  findingsBody,
  findingsWithout,
  hasSection,
  ownSections,
  planFindingsDelivery,
  queuedFindingsRun,
  renderFindingsMessage,
  renderAutoreviewBatch,
} from "./autoreviewBatch.ts";
import { latestExecutedRun } from "@t3tools/shared/orchestrationV2ThreadError";
import { visibleConversationItems } from "./ContextHandoffService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type {
  ProjectionRecordField,
  ProjectionRecordFilter,
  ProjectionRecords,
} from "./ProjectionStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export class AutoreviewError extends Schema.TaggedError<AutoreviewError>()("AutoreviewError", {
  reason: Schema.Literals(["not_found", "not_active", "invalid", "failed"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface AutoreviewAttachInput {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly brief?: string | undefined;
  /** See `OrchestrationV2Autoreviewer.minBatchChars`; 0 or absent sends at every idle point. */
  readonly minBatchChars?: number | undefined;
  readonly wakeOnUserMessage?: boolean | undefined;
  readonly wakeOnToolCall?: boolean | undefined;
  readonly minWakeIntervalSeconds?: number | undefined;
  readonly preamble?: string | undefined;
  readonly title?: string | undefined;
  readonly createdBy: "user" | "agent" | "system";
  readonly creationSource: "web" | "mobile" | "mcp" | "provider" | "server";
}

export interface AutoreviewerStatus {
  readonly reviewerThreadId: ThreadId;
  readonly taskId: NodeId;
  readonly title?: string | undefined;
  /** The reviewer's model and its options, e.g. "gpt-6.1-sol reasoningEffort=xhigh". */
  readonly model?: string | undefined;
  readonly brief?: string | undefined;
  readonly minBatchChars?: number | undefined;
  readonly wakeOnUserMessage?: boolean | undefined;
  readonly wakeOnToolCall?: boolean | undefined;
  readonly minWakeIntervalSeconds?: number | undefined;
  readonly state: "reviewing" | "idle";
  /** Finished items in the reviewed thread the reviewer has not received yet. */
  readonly bufferedItems: number;
}

export class AutoreviewService extends Context.Service<
  AutoreviewService,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
    readonly attach: (
      input: AutoreviewAttachInput,
    ) => Effect.Effect<
      { readonly reviewerThreadId: ThreadId; readonly taskId: NodeId },
      AutoreviewError
    >;
    readonly detach: (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      /** Omitted: every reviewer. */
      readonly reviewerThreadId?: ThreadId | undefined;
    }) => Effect.Effect<ReadonlyArray<ThreadId>, AutoreviewError>;
    /** Changes a reviewer's model or brief in place; it keeps its conversation and cursor. */
    readonly update: (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly reviewerThreadId: ThreadId;
      readonly modelSelection?: ModelSelection | undefined;
      /** An empty brief clears it. */
      readonly brief?: string | undefined;
      /** 0 clears it. */
      readonly minBatchChars?: number | undefined;
      readonly wakeOnUserMessage?: boolean | undefined;
      readonly wakeOnToolCall?: boolean | undefined;
      /** 0 clears it. */
      readonly minWakeIntervalSeconds?: number | undefined;
      /** An empty preamble restores the standard one. */
      readonly preamble?: string | undefined;
    }) => Effect.Effect<void, AutoreviewError>;
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<AutoreviewerStatus>, AutoreviewError>;
    /** Run by `start`: delivers reviews and sends buffers whose events were missed. */
    readonly catchUp: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/AutoreviewService") {}

const FINISHED_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const isBusy = (runs: ReadonlyArray<OrchestrationV2Run>) =>
  runs.some(
    (run) =>
      run.status === "preparing" ||
      run.status === "queued" ||
      run.status === "starting" ||
      run.status === "running" ||
      run.status === "waiting",
  );

const isGone = (thread: Pick<OrchestrationV2AppThread, "archivedAt" | "deletedAt">) =>
  thread.archivedAt !== null || thread.deletedAt !== null;

const describeCause = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const inner =
    typeof cause === "object" && cause !== null ? (cause as { cause?: unknown }).cause : undefined;
  return typeof inner === "string" && !message.includes(inner) ? `${message} ${inner}` : message;
};

const failed = (detail: string) => (cause: unknown) =>
  new AutoreviewError({ reason: "failed", detail: `${detail}: ${describeCause(cause)}` });

// Attach, detach, flushes and cursor updates rewrite one list per thread, so they run one at a
// time. The lock is per process: the reactor and the MCP tool may hold different service instances.
const autoreviewLock = Semaphore.makeUnsafe(1);
let cursorSequence = 0;

/** What autoreview reads and writes; both the orchestrator and ThreadManagementService offer it. */
type PortError =
  | Orchestrator.OrchestratorV2Error
  | ThreadManagementService.ThreadManagementProviderInstanceDisabledError;

export interface AutoreviewPort {
  readonly dispatch: (
    command: Parameters<Orchestrator.OrchestratorV2["Service"]["dispatch"]>[0],
  ) => Effect.Effect<Orchestrator.OrchestratorV2DispatchResult, PortError>;
  readonly getThreadRecords: <K extends ProjectionRecordField>(
    threadId: ThreadId,
    fields: ReadonlyArray<K>,
    filter?: ProjectionRecordFilter,
  ) => Effect.Effect<ProjectionRecords<K>, Orchestrator.OrchestratorV2Error>;
  readonly listActiveSubagentThreadIds: () => Effect.Effect<
    ReadonlyArray<ThreadId>,
    Orchestrator.OrchestratorV2Error
  >;
  readonly streamDomainEvents?: Stream.Stream<
    OrchestrationV2DomainEvent,
    Orchestrator.OrchestratorV2Error
  >;
}

/** Texts of the findings messages among `items`. */
const findingsTexts = (items: ReadonlyArray<OrchestrationV2TurnItem>): ReadonlyArray<string> =>
  items.flatMap((item) =>
    item.type === "user_message" && item.messageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX)
      ? [item.text]
      : [],
  );

// Sections normally leave the list once they come back in a batch; the bound only keeps a
// record small when a queued findings message was cancelled and its sections never return.
const MAX_OWN_SECTIONS = 200;

/** The record with its own sections in the current field and the older fields dropped. */
const withOwnSections = (
  reviewer: OrchestrationV2Autoreviewer,
  sections: ReadonlyArray<string>,
): OrchestrationV2Autoreviewer => {
  const { lastSection: _last, queuedSections: _queued, ...rest } = reviewer;
  return { ...rest, ownSections: sections.slice(-MAX_OWN_SECTIONS) };
};

export const make = (port: AutoreviewPort) => {
  const engine = port;
  const lock = autoreviewLock;
  const projections = {
    getThread: (threadId: ThreadId) =>
      port.getThreadRecords(threadId, []).pipe(Effect.map((records) => records.thread)),
    getThreadRecords: port.getThreadRecords,
    listActiveSubagentThreadIds: port.listActiveSubagentThreadIds,
  };
  const optionalRecords = <K extends ProjectionRecordField>(
    threadId: ThreadId,
    fields: ReadonlyArray<K>,
  ) => port.getThreadRecords(threadId, fields).pipe(Effect.catchCause(() => Effect.succeed(null)));

  const readReviewable = Effect.fnUntraced(function* (threadId: ThreadId) {
    const records = yield* projections.getThreadRecords(
      threadId,
      ["turnItems", "runs", "attempts"],
      {
        turnItemTypes: AUTOREVIEW_REVIEWABLE_TYPES,
      },
    );
    return { ...records, turnItems: visibleConversationItems(records, records.turnItems) };
  });

  const setReviewers = (
    commandId: string,
    threadId: ThreadId,
    autoreviewers: ReadonlyArray<OrchestrationV2Autoreviewer>,
  ) =>
    engine.dispatch({
      type: "thread.autoreviewers.set",
      commandId: CommandId.make(commandId),
      threadId,
      autoreviewers,
    });

  /**
   * Findings queue only when a steer is refused, e.g. before the provider turn has started.
   * Every later flush tries again to steer the waiting findings into the live turn.
   */
  const steerQueuedFindings = Effect.fnUntraced(function* (threadId: ThreadId) {
    const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    const waiting = queuedFindingsRun(runs);
    const delivery = planFindingsDelivery(runs);
    if (waiting === undefined || delivery.type !== "steer") return;
    const stamp = DateTime.toEpochMillis(yield* DateTime.now);
    yield* engine
      .dispatch({
        type: "queued-message.promote-to-steer",
        commandId: CommandId.make(
          `server:autoreview-steer:${waiting.id}:${stamp}:${++cursorSequence}`,
        ),
        threadId,
        queuedRunId: waiting.id,
        targetRunId: delivery.targetRunId,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("autoreview findings still cannot steer", { threadId, cause }),
        ),
      );
  });

  /** Delivers an idle reviewer's finished reviews, then sends it its buffer. */
  const flushReviewer = Effect.fnUntraced(function* (
    thread: OrchestrationV2AppThread,
    reviewed: Effect.Success<ReturnType<typeof readReviewable>>,
    state: { record: OrchestrationV2Autoreviewer; changed: boolean },
  ) {
    const child = yield* optionalRecords(state.record.threadId, ["runs"]);
    if (child === null || isGone(child.thread) || isBusy(child.runs)) return;
    // Every review finished since the last one handled is delivered, oldest first, before the
    // next batch goes out. A run typed to the reviewer meanwhile cannot hide an earlier review.
    const runs = child.runs.toSorted((left, right) => left.ordinal - right.ordinal);
    const handled = runs.find((run) => run.id === state.record.lastReviewedRunId);
    // With no handled run yet, every finished run is considered; the findings-message guard in
    // deliverFindings keeps a review that already reached the thread from going out twice.
    const pending = runs.filter(
      (run) =>
        run.status === "completed" && (handled === undefined || run.ordinal > handled.ordinal),
    );
    for (const run of pending) {
      const outcome = yield* deliverFindings(
        { parent: thread, child: child.thread, reviewer: state.record },
        run.id,
      );
      // Findings held back (the wake cap, or a Stop) are tried again on a later flush; the
      // reviewer gets no new batch until then, so a newer review cannot replace them.
      if (outcome.type === "held") return;
      state.record = withOwnSections(
        { ...state.record, lastReviewedRunId: run.id },
        outcome.section === undefined || ownSections(state.record).includes(outcome.section)
          ? ownSections(state.record)
          : [...ownSections(state.record), outcome.section],
      );
      state.changed = true;
    }
    const reviewer = state.record;
    const plan = planAutoreviewBatch({ reviewer, items: reviewed.turnItems, runs: reviewed.runs });
    const immediate = reviewer.wakeOnUserMessage === true && batchHasUserMessage(plan);
    if (!batchHasAgentActivity(plan) && !immediate) return;
    const busy = isBusy(reviewed.runs);
    const now = yield* DateTime.now;
    // Pacing applies while the thread works; its end and a user message always go out.
    const intervalMs = (reviewer.minWakeIntervalSeconds ?? 0) * 1000;
    const sinceLast =
      reviewer.lastBatchAt === undefined
        ? Number.POSITIVE_INFINITY
        : DateTime.toEpochMillis(now) - Date.parse(reviewer.lastBatchAt);
    if (!immediate && busy && sinceLast < intervalMs) return;
    const text = renderAutoreviewBatch({
      reviewedThread: thread,
      items: plan.items,
      first: false,
      brief: reviewer.brief,
      preamble: reviewer.preamble,
      ownFindings: ownSections(reviewer),
      instructions: reviewer.resendInstructions === true,
      running: plan.running,
    });
    // A slow reviewer waits for a large buffer, but always sees how the work ended, and one
    // with wakeOnToolCall sees each finished tool call.
    const toolWake = reviewer.wakeOnToolCall === true && batchHasToolCall(plan);
    if (!immediate && !toolWake && (reviewer.minBatchChars ?? 0) > text.length && busy) return;
    const last = plan.items.at(-1)!;
    const key = `${reviewer.threadId}:${last.ordinal}:${plan.items.length}`;
    yield* engine.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:autoreview-batch:${key}`),
      threadId: reviewer.threadId,
      messageId: MessageId.make(`${AUTOREVIEW_BATCH_MESSAGE_PREFIX}${key}`),
      text,
      attachments: [],
      // No sender thread and no notification: a batch never becomes a task result for the
      // reviewed thread; the reviewer's reply is delivered by this service instead.
      createdBy: "agent",
      creationSource: "server",
      dispatchMode: { type: "queue_after_active" },
    });
    const { resendInstructions: _resent, ...sent } = state.record;
    // Own sections this batch carried have come back; the reviewer will not see them again.
    const shown = findingsTexts(plan.items);
    state.record = withOwnSections(
      {
        ...sent,
        throughOrdinal: plan.throughOrdinal,
        sentItemIds: plan.sentItemIds,
        lastBatchAt: DateTime.formatIso(now),
      },
      ownSections(sent).filter((section) => !shown.some((text) => hasSection(text, section))),
    );
    state.changed = true;
  });

  /** Sends each idle reviewer its buffer; must run under `lock`. */
  const flushUnlocked = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* projections.getThread(threadId);
    const reviewers = thread.autoreviewers ?? [];
    if (reviewers.length === 0 || isGone(thread)) return;
    const reviewed = yield* readReviewable(threadId);
    const next = [...reviewers];
    let changed = false;
    for (const [index, reviewer] of reviewers.entries()) {
      // One reviewer's failure must not stop the others or lose the progress made for it.
      const state = { record: reviewer, changed: false };
      yield* flushReviewer(thread, reviewed, state).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("autoreview could not serve a reviewer", {
            threadId,
            reviewerThreadId: reviewer.threadId,
            cause,
          }),
        ),
      );
      if (state.changed) {
        next[index] = state.record;
        changed = true;
      }
    }
    yield* steerQueuedFindings(threadId);
    if (!changed) return;
    const cursor = next
      .map((reviewer) => `${reviewer.threadId}@${reviewer.throughOrdinal}`)
      .join(",");
    // Unique across restarts: a reused id would replay an old receipt and skip the update.
    const stamp = DateTime.toEpochMillis(yield* DateTime.now);
    yield* setReviewers(
      `server:autoreview-cursor:${threadId}:${cursor}:${stamp}:${++cursorSequence}`,
      threadId,
      next,
    );
  });

  const flush = (threadId: ThreadId) => lock.withPermits(1)(flushUnlocked(threadId));

  /** The reviewed thread and reviewer record, when `childThreadId` is an attached reviewer. */
  const reviewerOf = Effect.fnUntraced(function* (childThreadId: ThreadId) {
    const child = yield* projections.getThread(childThreadId);
    const parentThreadId = child.lineage.parentThreadId;
    if (parentThreadId === null || child.lineage.relationshipToParent !== "subagent") return null;
    const parent = yield* projections.getThread(parentThreadId);
    const reviewer = parent.autoreviewers?.find((entry) => entry.threadId === childThreadId);
    return reviewer === undefined ? null : { parent, child, reviewer };
  });

  /**
   * Delivers one finished review; must run under `lock`. "held" means the wake cap or a Stop kept
   * it back and a later flush tries again; "done" covers delivered, LGTM and not-ours.
   */
  const deliverFindings = Effect.fnUntraced(function* (
    found: {
      readonly parent: OrchestrationV2AppThread;
      readonly child: OrchestrationV2AppThread;
      readonly reviewer: OrchestrationV2Autoreviewer;
    },
    runId: RunId,
  ) {
    const done = { type: "done" as const, section: undefined as string | undefined };
    const reviewerRecords = yield* projections.getThreadRecords(found.child.id, ["runs"]);
    const run = reviewerRecords.runs.find((candidate) => candidate.id === runId);
    if (run === undefined || run.status !== "completed") return done;
    const firstRun = reviewerRecords.runs.toSorted((a, b) => a.ordinal - b.ordinal)[0];
    // Only reviews this service asked for; a message someone typed to the reviewer is a normal
    // subagent follow-up and is delivered by the delegated task machinery.
    if (!run.userMessageId.startsWith(AUTOREVIEW_BATCH_MESSAGE_PREFIX) && firstRun?.id !== run.id) {
      return done;
    }
    const { turnItems } = yield* projections.getThreadRecords(found.child.id, ["turnItems"], {
      turnItemRunId: run.id,
      turnItemTypes: ["assistant_message"],
    });
    const review = turnItems
      .filter((item) => item.type === "assistant_message" && item.text.trim().length > 0)
      .toSorted((a, b) => a.ordinal - b.ordinal)
      .at(-1);
    if (review?.type !== "assistant_message" || isLgtmReview(review.text)) return done;
    if (isGone(found.parent)) return done;
    const messageId = MessageId.make(`${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}${run.id}`);
    const section = findingsSection({ reviewerTitle: found.child.title, review: review.text });
    // A review the thread already shows, steered, queued or appended to another reviewer's
    // findings, was delivered (a guard beside lastReviewedRunId, for records that lost it).
    // Read fresh: queued messages are not among the visible items, and edits change them.
    const { runs: parentRuns } = yield* projections.getThreadRecords(found.parent.id, ["runs"]);
    // Its own message id covers a steer, which joins a run without becoming its first message.
    const findingsIds = [
      messageId,
      ...parentRuns
        .map((candidate) => candidate.userMessageId)
        .filter((id) => id !== messageId && id.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX)),
    ];
    const { messages: delivered } = yield* projections.getThreadRecords(
      found.parent.id,
      ["messages"],
      { messageIds: findingsIds },
    );
    // The section stays the reviewer's own, so removal and its batches still recognize it.
    if (delivered.some((message) => hasSection(message.text, section))) {
      return { type: "done" as const, section };
    }
    const sent = { type: "done" as const, section };
    // A Stop that reached a turn as it completed leaves the run completed, with only the request.
    const latest = latestExecutedRun(parentRuns);
    const stopRequests =
      latest === null
        ? []
        : (yield* projections.getThreadRecords(found.parent.id, ["turnItems"], {
            turnItemRunId: latest.id,
            turnItemTypes: ["run_interrupt_request"],
          })).turnItems;
    const delivery = planFindingsDelivery(parentRuns, stopRequests.length > 0);
    if (delivery.type === "skip") {
      yield* Effect.logInfo("autoreview findings were not delivered", {
        threadId: found.parent.id,
        reviewerThreadId: found.child.id,
        reason: delivery.reason,
      });
      return { type: "held" as const, section: undefined, queued: false };
    }
    const message = (kind: string) => ({
      type: "message.dispatch" as const,
      commandId: CommandId.make(`server:autoreview-findings:${kind}:${run.id}`),
      threadId: found.parent.id,
      messageId,
      text: renderFindingsMessage([section]),
      // No notification: findings must be able to steer, and queued ones stay editable so
      // later findings can join them.
      senderThreadId: found.child.id,
      attachments: [],
      createdBy: "agent" as const,
      creationSource: "server" as const,
    });
    if (delivery.type === "steer") {
      const steered = yield* engine
        .dispatch({
          ...message("steer"),
          dispatchMode: { type: "steer_active", targetRunId: delivery.targetRunId },
        })
        .pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logInfo("autoreview findings could not steer; queueing them", {
              threadId: found.parent.id,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      if (steered) return sent;
    }
    // Not steerable now: join the findings already waiting, so the queue holds one message.
    const fresh = yield* projections.getThreadRecords(found.parent.id, ["runs"]);
    const waiting = queuedFindingsRun(fresh.runs);
    if (waiting !== undefined) {
      const { messages } = yield* projections.getThreadRecords(found.parent.id, ["messages"], {
        messageIds: [waiting.userMessageId],
      });
      // Appended, never replacing: every finding waiting in the queue stays there.
      const joined = yield* engine
        .dispatch({
          type: "queued-run.edit",
          commandId: CommandId.make(`server:autoreview-findings:append:${run.id}`),
          threadId: found.parent.id,
          runId: waiting.id,
          text: `${messages[0]?.text ?? ""}\n\n${section}`.trim(),
        })
        .pipe(
          Effect.as(true),
          // The queued run may have started meanwhile; then the findings get their own message.
          Effect.catchCause(() => Effect.succeed(false)),
        );
      if (joined) return sent;
    }
    yield* engine.dispatch({ ...message("queue"), dispatchMode: { type: "queue_after_active" } });
    return sent;
  });

  const handle: AutoreviewService["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      switch (event.type) {
        case "turn-item.updated": {
          if (!isTerminalItem(event.payload) || !isReviewableItem(event.payload)) return;
          const thread = yield* projections.getThread(event.threadId);
          if ((thread.autoreviewers?.length ?? 0) > 0) yield* flush(event.threadId);
          return;
        }
        case "thread.metadata-updated":
          if ((event.payload.autoreviewers?.length ?? 0) > 0) yield* flush(event.threadId);
          return;
        case "run.updated": {
          if (!FINISHED_RUN_STATUSES.has(event.payload.status)) return;
          // A finished review is delivered by the flush, which checks under the lock that the
          // reviewer is still attached.
          const found = yield* reviewerOf(event.threadId);
          if (found !== null) {
            yield* flush(found.parent.id);
            return;
          }
          const thread = yield* projections.getThread(event.threadId);
          if ((thread.autoreviewers?.length ?? 0) > 0) yield* flush(event.threadId);
          return;
        }
        default:
          return;
      }
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("autoreview failed to handle an event", {
            threadId: event.threadId,
            eventType: event.type,
            cause,
          }),
        ),
      ),
  );

  const attach: AutoreviewService["Service"]["attach"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const reviewed = yield* readReviewable(input.threadId).pipe(
          Effect.mapError(
            () =>
              new AutoreviewError({
                reason: "not_found",
                detail: `Thread ${input.threadId} was not found.`,
              }),
          ),
        );
        if (isGone(reviewed.thread)) {
          return yield* new AutoreviewError({
            reason: "invalid",
            detail: `Thread ${input.threadId} is archived or deleted.`,
          });
        }
        const parentRun = reviewed.runs
          .filter(
            (run) =>
              run.status === "preparing" ||
              run.status === "starting" ||
              run.status === "running" ||
              run.status === "waiting",
          )
          .toSorted((left, right) => right.ordinal - left.ordinal)[0];
        if (parentRun === undefined || parentRun.rootNodeId === null) {
          return yield* new AutoreviewError({
            reason: "not_active",
            detail: `Thread ${input.threadId} has no running turn. Attach a reviewer while the thread is working.`,
          });
        }
        // The backlog is the first batch: everything so far, newest kept when it is too long.
        const plan = planAutoreviewBatch({
          reviewer: { throughOrdinal: -1, sentItemIds: [] },
          items: reviewed.turnItems,
        });
        const result = yield* engine
          .dispatch({
            type: "delegated_task.request",
            commandId: input.commandId,
            createdBy: input.createdBy,
            creationSource: input.creationSource,
            parentThreadId: input.threadId,
            parentRunId: parentRun.id,
            parentNodeId: parentRun.rootNodeId,
            task: renderAutoreviewBatch({
              reviewedThread: reviewed.thread,
              items: plan.items,
              first: true,
              brief: input.brief,
              preamble: input.preamble,
            }),
            title: input.title?.trim() || `Autoreview: ${reviewed.thread.title}`.slice(0, 120),
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            completionWake: "always",
          })
          .pipe(Effect.mapError(failed("Unable to start the reviewer")));
        const taskEvent = result.storedEvents
          .map((stored) => stored.event)
          .find(
            (event): event is Extract<OrchestrationV2DomainEvent, { type: "subagent.updated" }> =>
              event.type === "subagent.updated" && event.payload.origin === "app_owned",
          );
        const reviewerThreadId = taskEvent?.payload.childThreadId ?? null;
        if (taskEvent === undefined || reviewerThreadId === null) {
          return yield* new AutoreviewError({
            reason: "failed",
            detail: "Starting the reviewer did not create a subagent thread.",
          });
        }
        const taskId = taskEvent.payload.id;
        // Reviews reach the reviewed thread through this service, never as a task result.
        yield* engine
          .dispatch({
            type: "delegated_task.completion-delivery.dispose",
            commandId: CommandId.make(`${input.commandId}:autoreview-dispose`),
            parentThreadId: input.threadId,
            taskId,
          })
          .pipe(Effect.mapError(failed("Unable to detach the reviewer's task result")));
        const current =
          (yield* projections
            .getThread(input.threadId)
            .pipe(Effect.mapError(failed("Unable to read the reviewed thread")))).autoreviewers ??
          [];
        if (!current.some((reviewer) => reviewer.threadId === reviewerThreadId)) {
          const now = yield* DateTime.now;
          yield* setReviewers(`${input.commandId}:autoreview-attach`, input.threadId, [
            ...current,
            {
              threadId: reviewerThreadId,
              taskId,
              ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
              ...(input.minBatchChars ? { minBatchChars: input.minBatchChars } : {}),
              ...(input.wakeOnUserMessage ? { wakeOnUserMessage: true } : {}),
              ...(input.wakeOnToolCall ? { wakeOnToolCall: true } : {}),
              ...(input.minWakeIntervalSeconds
                ? { minWakeIntervalSeconds: input.minWakeIntervalSeconds }
                : {}),
              ...(input.preamble?.trim() ? { preamble: input.preamble.trim() } : {}),
              throughOrdinal: plan.throughOrdinal,
              sentItemIds: plan.sentItemIds,
              addedAt: DateTime.formatIso(now),
            },
          ]).pipe(Effect.mapError(failed("Unable to record the reviewer")));
        }
        return { reviewerThreadId, taskId };
      }),
    );

  const dropPendingFindings = Effect.fnUntraced(function* (
    commandId: CommandId,
    threadId: ThreadId,
    removed: ReadonlyArray<OrchestrationV2Autoreviewer>,
  ) {
    const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    const waiting = runs.filter(
      (run) =>
        run.status === "queued" && run.userMessageId.startsWith(AUTOREVIEW_FINDINGS_MESSAGE_PREFIX),
    );
    for (const run of waiting) {
      const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
        messageIds: [run.userMessageId],
      });
      const original = messages[0]?.text ?? "";
      const kept = removed
        .flatMap((reviewer) => ownSections(reviewer))
        .reduce((text, section) => findingsWithout(text, section), original);
      if (kept === original) continue;
      yield* findingsBody(kept).length === 0
        ? engine.dispatch({
            type: "queued-run.cancel",
            commandId: CommandId.make(`${commandId}:drop-findings:${run.id}`),
            threadId,
            runId: run.id,
          })
        : engine.dispatch({
            type: "queued-run.edit",
            commandId: CommandId.make(`${commandId}:drop-findings:${run.id}`),
            threadId,
            runId: run.id,
            text: kept,
          });
    }
  });

  const update: AutoreviewService["Service"]["update"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const thread = yield* projections.getThread(input.threadId).pipe(
          Effect.mapError(
            () =>
              new AutoreviewError({
                reason: "not_found",
                detail: `Thread ${input.threadId} was not found.`,
              }),
          ),
        );
        const current = thread.autoreviewers ?? [];
        const index = current.findIndex((reviewer) => reviewer.threadId === input.reviewerThreadId);
        if (index === -1) {
          return yield* new AutoreviewError({
            reason: "not_found",
            detail: `Thread ${input.reviewerThreadId} is not an autoreviewer of thread ${input.threadId}.`,
          });
        }
        if (
          input.modelSelection === undefined &&
          input.brief === undefined &&
          input.minBatchChars === undefined &&
          input.wakeOnUserMessage === undefined &&
          input.wakeOnToolCall === undefined &&
          input.minWakeIntervalSeconds === undefined &&
          input.preamble === undefined
        ) {
          return yield* new AutoreviewError({
            reason: "invalid",
            detail:
              "Pass a new target, brief, preamble, minBatchChars, wakeOnUserMessage, wakeOnToolCall or minWakeIntervalSeconds.",
          });
        }
        if (input.modelSelection !== undefined) {
          // Takes effect on the reviewer's next turn; its conversation and cursor stay.
          yield* engine
            .dispatch({
              type: "thread.model-selection.set",
              commandId: CommandId.make(`${input.commandId}:model`),
              threadId: input.reviewerThreadId,
              modelSelection: input.modelSelection,
            })
            .pipe(Effect.mapError(failed("Unable to change the reviewer's model")));
        }
        const {
          brief: _brief,
          minBatchChars: _min,
          preamble: _preamble,
          wakeOnUserMessage: _wake,
          wakeOnToolCall: _toolWake,
          minWakeIntervalSeconds: _interval,
          ...reviewer
        } = current[index]!;
        const wakeOnToolCall =
          input.wakeOnToolCall === undefined ? _toolWake : input.wakeOnToolCall || undefined;
        const minWakeIntervalSeconds =
          input.minWakeIntervalSeconds === undefined
            ? _interval
            : input.minWakeIntervalSeconds || undefined;
        const wakeOnUserMessage =
          input.wakeOnUserMessage === undefined ? _wake : input.wakeOnUserMessage || undefined;
        const preamble =
          input.preamble === undefined ? _preamble : input.preamble.trim() || undefined;
        const brief = input.brief === undefined ? _brief : input.brief.trim() || undefined;
        const minBatchChars =
          input.minBatchChars === undefined ? _min : input.minBatchChars || undefined;
        const resend =
          input.modelSelection !== undefined ||
          input.brief !== undefined ||
          input.preamble !== undefined ||
          reviewer.resendInstructions;
        const next = [...current];
        next[index] = {
          ...reviewer,
          ...(brief === undefined ? {} : { brief }),
          ...(minBatchChars === undefined ? {} : { minBatchChars }),
          ...(wakeOnUserMessage === undefined ? {} : { wakeOnUserMessage }),
          ...(wakeOnToolCall === undefined ? {} : { wakeOnToolCall }),
          ...(minWakeIntervalSeconds === undefined ? {} : { minWakeIntervalSeconds }),
          ...(preamble === undefined ? {} : { preamble }),
          ...(resend ? { resendInstructions: true } : {}),
        };
        yield* setReviewers(`${input.commandId}:autoreview-update`, input.threadId, next).pipe(
          Effect.mapError(failed("Unable to record the reviewer")),
        );
      }),
    );

  const detach: AutoreviewService["Service"]["detach"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const thread = yield* projections.getThread(input.threadId).pipe(
          Effect.mapError(
            () =>
              new AutoreviewError({
                reason: "not_found",
                detail: `Thread ${input.threadId} was not found.`,
              }),
          ),
        );
        const current = thread.autoreviewers ?? [];
        const removed = current.filter(
          (reviewer) =>
            input.reviewerThreadId === undefined || reviewer.threadId === input.reviewerThreadId,
        );
        if (input.reviewerThreadId !== undefined && removed.length === 0) {
          return yield* new AutoreviewError({
            reason: "not_found",
            detail: `Thread ${input.reviewerThreadId} is not an autoreviewer of thread ${input.threadId}.`,
          });
        }
        if (removed.length === 0) return [];
        yield* setReviewers(
          input.commandId,
          input.threadId,
          current.filter((reviewer) => !removed.includes(reviewer)),
        ).pipe(Effect.mapError(failed("Unable to detach the reviewer")));
        // Findings still waiting in the queue go with the reviewer.
        yield* dropPendingFindings(input.commandId, input.threadId, removed).pipe(
          Effect.mapError(failed("Unable to drop the reviewer's pending findings")),
        );
        return removed.map((reviewer) => reviewer.threadId);
      }),
    );

  const list: AutoreviewService["Service"]["list"] = Effect.fn("AutoreviewService.list")(
    function* (threadId) {
      const reviewed = yield* readReviewable(threadId).pipe(
        Effect.mapError(
          () =>
            new AutoreviewError({
              reason: "not_found",
              detail: `Thread ${threadId} was not found.`,
            }),
        ),
      );
      const statuses: Array<AutoreviewerStatus> = [];
      for (const reviewer of reviewed.thread.autoreviewers ?? []) {
        const child = yield* optionalRecords(reviewer.threadId, ["runs"]);
        statuses.push({
          reviewerThreadId: reviewer.threadId,
          taskId: reviewer.taskId,
          ...(child === null
            ? {}
            : {
                title: child.thread.title,
                model: [
                  child.thread.modelSelection.model,
                  ...(child.thread.modelSelection.options ?? []).map(
                    (option) => `${option.id}=${String(option.value)}`,
                  ),
                ].join(" "),
              }),
          ...(reviewer.brief === undefined ? {} : { brief: reviewer.brief }),
          ...(reviewer.minBatchChars === undefined
            ? {}
            : { minBatchChars: reviewer.minBatchChars }),
          ...(reviewer.wakeOnUserMessage === undefined
            ? {}
            : { wakeOnUserMessage: reviewer.wakeOnUserMessage }),
          ...(reviewer.wakeOnToolCall === undefined
            ? {}
            : { wakeOnToolCall: reviewer.wakeOnToolCall }),
          ...(reviewer.minWakeIntervalSeconds === undefined
            ? {}
            : { minWakeIntervalSeconds: reviewer.minWakeIntervalSeconds }),
          state: child !== null && isBusy(child.runs) ? "reviewing" : "idle",
          bufferedItems: planAutoreviewBatch({
            reviewer,
            items: reviewed.turnItems,
            runs: reviewed.runs,
          }).items.length,
        });
      }
      return statuses;
    },
  );

  // Events are not replayed after a restart, so reviews and buffers that finished meanwhile
  // go out now; each flush delivers an idle reviewer's finished review first.
  const catchUp = Effect.gen(function* () {
    const subagentIds = yield* projections.listActiveSubagentThreadIds();
    const parents = new Set<ThreadId>();
    for (const childId of subagentIds) {
      yield* lock
        .withPermits(1)(
          Effect.gen(function* () {
            const found = yield* reviewerOf(childId);
            if (found !== null) parents.add(found.parent.id);
          }),
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("autoreview catch-up failed", { threadId: childId, cause }),
          ),
        );
    }
    for (const parentId of parents) {
      yield* flush(parentId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("autoreview catch-up failed", { threadId: parentId, cause }),
        ),
      );
    }
  }).pipe(Effect.catchCause((cause) => Effect.logWarning("autoreview catch-up failed", { cause })));

  const events = port.streamDomainEvents;
  const start: AutoreviewService["Service"]["start"] = () =>
    events === undefined
      ? Effect.void
      : // Subscribe before catching up so nothing lands between the two.
        forkParked(
          Effect.all(
            [
              Stream.runForEach(events, handle).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("autoreview event stream failed", { cause }),
                ),
              ),
              Effect.andThen(Effect.yieldNow, catchUp),
            ],
            { concurrency: 2, discard: true },
          ),
        );

  return {
    start,
    handle,
    attach,
    detach,
    update,
    list,
    catchUp,
  } satisfies AutoreviewService["Service"];
};

/** The reactor: follows orchestration events and feeds reviewers. */
export const layer = Layer.effect(
  AutoreviewService,
  Effect.gen(function* () {
    return make(yield* Orchestrator.OrchestratorV2);
  }),
);

/** For the MCP tool: attach, detach and list. It does not follow events; the reactor does. */
export const layerFromThreadManagement = Layer.effect(
  AutoreviewService,
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    return make({
      dispatch: threads.dispatch,
      getThreadRecords: threads.getThreadRecords,
      listActiveSubagentThreadIds: threads.listActiveSubagentThreadIds,
    });
  }),
);
