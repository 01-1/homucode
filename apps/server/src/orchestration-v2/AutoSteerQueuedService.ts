import {
  CommandId,
  isCompactionCommandMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import { isActiveRun, resolveMessageDispatchIntent } from "./CommandPolicy.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { queuedRunsInDeliveryOrder } from "./QueuedRunOrder.ts";

/** Safety bound; each promotion consumes one queued run, so a pass ends long before this. */
const MAX_PROMOTIONS_PER_PASS = 500;

/**
 * Sends that asked to steer (auto/steer) queue when the turn cannot take a steer yet: a
 * compaction is running, or the run is preparing/starting, or between provider turns. Those
 * runs carry `autoSteer`. Whenever a steerable turn exists, this promotes them to steers from
 * the head of the queue, so nothing waits for a manual "Send now". It stops at the first
 * queued run that is held or did not ask to steer, so queue order is never jumped.
 */
export interface AutoSteerPromotion {
  readonly queuedRunId: OrchestrationV2Run["id"];
  readonly targetRunId: OrchestrationV2Run["id"];
  readonly skipsCompaction: boolean;
}

export function nextAutoSteerPromotion(projection: {
  readonly thread?: object;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly messages: Parameters<typeof resolveMessageDispatchIntent>[0]["messages"];
  readonly providerTurns: Parameters<typeof resolveMessageDispatchIntent>[0]["providerTurns"];
  readonly providerThreads: Parameters<typeof resolveMessageDispatchIntent>[0]["providerThreads"];
  readonly providerSessions: Parameters<
    typeof resolveMessageDispatchIntent
  >[0]["providerSessions"];
}): AutoSteerPromotion | null {
  const head = queuedRunsInDeliveryOrder(
    projection as Parameters<typeof queuedRunsInDeliveryOrder>[0],
  )[0];
  if (
    head === undefined ||
    head.autoSteer !== true ||
    head.queueHeld === true ||
    // Host status-check continuations must reach their own startup guard, never steer.
    head.restartContinuationOfRunId !== undefined ||
    // Retirement fences (added by the role-retirement release); absent fields read as unset.
    ((head as { readonly retirementHold?: unknown }).retirementHold ?? null) !== null ||
    ((projection.thread as { readonly roleRetirement?: unknown } | undefined)?.roleRetirement ??
      null) !== null
  )
    return null;
  const activeRun = projection.runs.findLast(isActiveRun);
  if (activeRun === undefined) return null;
  const activeMessage = projection.messages.find(
    (message) => message.id === activeRun.userMessageId,
  );
  // Promote skips a compaction and starts the message, as the manual Steer button does.
  if (activeMessage !== undefined && isCompactionCommandMessage(activeMessage)) {
    return { queuedRunId: head.id, targetRunId: activeRun.id, skipsCompaction: true };
  }
  const mode = resolveMessageDispatchIntent(
    projection as Parameters<typeof resolveMessageDispatchIntent>[0],
    { type: "start_immediately" },
    "auto",
  );
  return mode.type === "steer_active"
    ? { queuedRunId: head.id, targetRunId: mode.targetRunId, skipsCompaction: false }
    : null;
}

const triggers = (event: OrchestrationV2DomainEvent): boolean =>
  (event.type === "provider-turn.updated" && event.payload.status === "running") ||
  ((event.type === "run.created" || event.type === "run.updated") &&
    (event.payload.status === "running" ||
      (event.payload.status === "queued" && event.payload.autoSteer === true)));

export interface AutoSteerPassDeps<R> {
  /** Threads that got a trigger since their pass last read; a pass consumes its own entry. */
  readonly dirty: Set<ThreadId>;
  readonly compactionsSkipped: Set<string>;
  readonly read: (threadId: ThreadId) => Effect.Effect<R | null, unknown>;
  readonly select: (records: R) => AutoSteerPromotion | null;
  readonly dispatch: (threadId: ThreadId, next: AutoSteerPromotion) => Effect.Effect<unknown, unknown>;
}

/**
 * One drain of a thread's queue. A refused promotion (the locked recheck saw a reorder or a
 * hold) ends the pass unless a trigger arrived meanwhile; then the queue is read again, so the
 * new head is not stranded until the next turn event.
 */
export const runAutoSteerPass = <R>(deps: AutoSteerPassDeps<R>, threadId: ThreadId) =>
  Effect.gen(function* () {
  deps.dirty.delete(threadId);
  for (let pass = 0; pass < MAX_PROMOTIONS_PER_PASS; pass++) {
    const records = yield* deps.read(threadId);
    if (records === null) return;
    const next = deps.select(records);
    if (next === null || (next.skipsCompaction && deps.compactionsSkipped.has(next.targetRunId))) {
      if (!deps.dirty.delete(threadId)) return;
      continue;
    }
    if (next.skipsCompaction) {
      if (deps.compactionsSkipped.size > 1_000) deps.compactionsSkipped.clear();
      deps.compactionsSkipped.add(next.targetRunId);
    }
    const exit = yield* Effect.exit(deps.dispatch(threadId, next));
    if (exit._tag === "Failure") {
      if (next.skipsCompaction) deps.compactionsSkipped.delete(next.targetRunId);
      yield* Effect.logDebug("queued send still cannot steer", { threadId, cause: exit.cause });
      if (!deps.dirty.delete(threadId)) return;
    }
  }
  yield* Effect.logWarning("auto-steer pass hit its bound; the next turn event continues", {
    threadId,
  });
  });

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  let sequence = 0;
  // Threads that got a trigger while their pass was running; the pass runs again for them.
  const dirty = new Set<ThreadId>();
  // Compaction runs already asked to stop for a queued send. The stop settles later, and
  // asking again would emit queued-run updates that retrigger this service in a loop.
  const compactionsSkipped = new Set<string>();

  const promote = (threadId: ThreadId) =>
    runAutoSteerPass(
      {
        dirty,
        compactionsSkipped,
        read: (id) =>
          projections
            .getThreadRecords(id, [
              "runs",
              "messages",
              "providerTurns",
              "providerThreads",
              "providerSessions",
            ])
            .pipe(
              Effect.map((records) =>
                records.thread.archivedAt !== null || records.thread.deletedAt !== null
                  ? null
                  : records,
              ),
            ),
        select: nextAutoSteerPromotion,
        dispatch: (id, next) =>
          DateTime.now.pipe(
            Effect.flatMap((now) =>
              orchestrator.dispatch({
                type: "queued-message.promote-to-steer",
                commandId: CommandId.make(
                  `server:auto-steer:${next.queuedRunId}:${DateTime.toEpochMillis(now)}:${++sequence}`,
                ),
                threadId: id,
                queuedRunId: next.queuedRunId,
                targetRunId: next.targetRunId,
              }),
            ),
          ),
      },
      threadId,
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug("auto-steer pass could not read the thread", { threadId, cause }),
      ),
    );

  const start = Effect.fn("AutoSteerQueuedService.start")(function* () {
    // Keyed by thread so passes for one thread never race each other.
    const passes = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        triggers(event)
          ? Effect.sync(() => dirty.add(event.threadId)).pipe(
              Effect.andThen(FiberMap.has(passes, event.threadId)),
              Effect.flatMap((running) =>
                running ? Effect.void : FiberMap.run(passes, event.threadId, promote(event.threadId)).pipe(Effect.asVoid),
              ),
            )
          : Effect.void,
      ),
    );
  });
  return { start };
});
