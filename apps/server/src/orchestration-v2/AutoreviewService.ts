import {
  CommandId,
  MessageId,
  type ModelSelection,
  type NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Autoreviewer,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
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
  parseFindingsSections,
  planFindingsDelivery,
  queuedFindingsRun,
  renderFindingsMessage,
  renderAutoreviewBatch,
} from "./autoreviewBatch.ts";
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
  readonly title?: string | undefined;
  readonly createdBy: "user" | "agent" | "system";
  readonly creationSource: "web" | "mobile" | "mcp" | "provider" | "server";
}

export interface AutoreviewerStatus {
  readonly reviewerThreadId: ThreadId;
  readonly taskId: NodeId;
  readonly brief?: string | undefined;
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

  /** Sends each idle reviewer its buffer; must run under `lock`. */
  const flushUnlocked = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* projections.getThread(threadId);
    const reviewers = thread.autoreviewers ?? [];
    if (reviewers.length === 0 || isGone(thread)) return;
    const reviewed = yield* readReviewable(threadId);
    const next = [...reviewers];
    let changed = false;
    for (const [index, reviewer] of reviewers.entries()) {
      const child = yield* optionalRecords(reviewer.threadId, ["runs"]);
      if (child === null || isGone(child.thread) || isBusy(child.runs)) continue;
      // A finished review is delivered before the next batch goes out, so a review whose
      // completion event was missed (a restart) is not overtaken and lost.
      const latest = child.runs.toSorted((left, right) => right.ordinal - left.ordinal)[0];
      if (latest?.status === "completed" && latest.id !== reviewer.lastReviewedRunId) {
        const outcome = yield* deliverFindings({ parent: thread, child: child.thread }, latest.id);
        // Findings held back by the wake cap are tried again on a later flush.
        if (outcome !== "held") {
          next[index] = { ...next[index]!, lastReviewedRunId: latest.id };
          changed = true;
        }
      }
      const plan = planAutoreviewBatch({ reviewer, items: reviewed.turnItems });
      if (!batchHasAgentActivity(plan)) continue;
      const last = plan.items.at(-1)!;
      const key = `${reviewer.threadId}:${last.ordinal}:${plan.items.length}`;
      yield* engine.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:autoreview-batch:${key}`),
        threadId: reviewer.threadId,
        messageId: MessageId.make(`${AUTOREVIEW_BATCH_MESSAGE_PREFIX}${key}`),
        text: renderAutoreviewBatch({
          reviewedThread: thread,
          items: plan.items,
          first: false,
          brief: reviewer.brief,
          reviewerThreadId: reviewer.threadId,
          instructions: reviewer.resendInstructions === true,
        }),
        attachments: [],
        // No sender thread and no notification: a batch never becomes a task result for the
        // reviewed thread; the reviewer's reply is delivered by this service instead.
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "queue_after_active" },
      });
      const { resendInstructions: _resent, ...sent } = next[index]!;
      next[index] = {
        ...sent,
        throughOrdinal: plan.throughOrdinal,
        sentItemIds: plan.sentItemIds,
      };
      changed = true;
    }
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
   * Delivers one finished review; must run under `lock`. "held" means the wake cap kept it back
   * and a later flush tries again; "done" covers delivered, LGTM and not-ours.
   */
  const deliverFindings = Effect.fnUntraced(function* (
    found: { readonly parent: OrchestrationV2AppThread; readonly child: OrchestrationV2AppThread },
    runId: RunId,
  ) {
    const reviewerRecords = yield* projections.getThreadRecords(found.child.id, ["runs"]);
    const run = reviewerRecords.runs.find((candidate) => candidate.id === runId);
    if (run === undefined || run.status !== "completed") return "done" as const;
    const firstRun = reviewerRecords.runs.toSorted((a, b) => a.ordinal - b.ordinal)[0];
    // Only reviews this service asked for; a message someone typed to the reviewer is a normal
    // subagent follow-up and is delivered by the delegated task machinery.
    if (!run.userMessageId.startsWith(AUTOREVIEW_BATCH_MESSAGE_PREFIX) && firstRun?.id !== run.id) {
      return "done" as const;
    }
    const { turnItems } = yield* projections.getThreadRecords(found.child.id, ["turnItems"], {
      turnItemRunId: run.id,
      turnItemTypes: ["assistant_message"],
    });
    const review = turnItems
      .filter((item) => item.type === "assistant_message" && item.text.trim().length > 0)
      .toSorted((a, b) => a.ordinal - b.ordinal)
      .at(-1);
    if (review?.type !== "assistant_message" || isLgtmReview(review.text)) return "done" as const;
    if (isGone(found.parent)) return "done" as const;
    const section = findingsSection({
      reviewerThreadId: found.child.id,
      reviewerTitle: found.child.title,
      review: review.text,
    });
    const { runs } = yield* projections.getThreadRecords(found.parent.id, ["runs"]);
    const delivery = planFindingsDelivery(runs);
    if (delivery.type === "skip") {
      yield* Effect.logInfo("autoreview findings were not delivered", {
        threadId: found.parent.id,
        reviewerThreadId: found.child.id,
        reason: delivery.reason,
      });
      return "held" as const;
    }
    const message = (kind: string) => ({
      type: "message.dispatch" as const,
      commandId: CommandId.make(`server:autoreview-findings:${kind}:${run.id}`),
      threadId: found.parent.id,
      messageId: MessageId.make(`${AUTOREVIEW_FINDINGS_MESSAGE_PREFIX}${run.id}`),
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
      if (steered) return "done" as const;
    }
    // Not steerable now: join the findings already waiting, so the queue holds one message.
    const fresh = yield* projections.getThreadRecords(found.parent.id, ["runs"]);
    const waiting = queuedFindingsRun(fresh.runs);
    if (waiting !== undefined) {
      const { messages } = yield* projections.getThreadRecords(found.parent.id, ["messages"], {
        messageIds: [waiting.userMessageId],
      });
      const sections = parseFindingsSections(messages[0]?.text ?? "").filter(
        (existing) => existing.reviewerThreadId !== found.child.id,
      );
      yield* engine.dispatch({
        type: "queued-run.edit",
        commandId: CommandId.make(`server:autoreview-findings:append:${run.id}`),
        threadId: found.parent.id,
        runId: waiting.id,
        // A reviewer's newer findings replace its older ones that never went out.
        text: renderFindingsMessage([...sections, section]),
      });
      return "done" as const;
    }
    yield* engine.dispatch({ ...message("queue"), dispatchMode: { type: "queue_after_active" } });
    return "done" as const;
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
    reviewerIds: ReadonlySet<string>,
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
      const sections = parseFindingsSections(messages[0]?.text ?? "");
      const kept = sections.filter((section) => !reviewerIds.has(section.reviewerThreadId));
      if (kept.length === sections.length) continue;
      yield* kept.length === 0
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
            text: renderFindingsMessage(kept),
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
        if (input.modelSelection === undefined && input.brief === undefined) {
          return yield* new AutoreviewError({
            reason: "invalid",
            detail: "Pass a new target, a new brief, or both.",
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
        const { brief: _brief, ...reviewer } = current[index]!;
        const brief = input.brief === undefined ? _brief : input.brief.trim() || undefined;
        const next = [...current];
        next[index] = {
          ...reviewer,
          ...(brief === undefined ? {} : { brief }),
          resendInstructions: true,
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
        const removedIds = new Set<string>(removed.map((reviewer) => reviewer.threadId));
        yield* dropPendingFindings(input.commandId, input.threadId, removedIds).pipe(
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
          ...(reviewer.brief === undefined ? {} : { brief: reviewer.brief }),
          state: child !== null && isBusy(child.runs) ? "reviewing" : "idle",
          bufferedItems: planAutoreviewBatch({ reviewer, items: reviewed.turnItems }).items.length,
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
