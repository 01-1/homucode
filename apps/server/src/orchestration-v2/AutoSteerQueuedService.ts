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

/** Most queued sends steered into one turn per trigger; the rest go on the next trigger. */
const MAX_PROMOTIONS_PER_PASS = 20;

/**
 * Sends that asked to steer (auto/steer) queue when the turn cannot take a steer yet: a
 * compaction is running, or the run is preparing/starting, or between provider turns. Those
 * runs carry `autoSteer`. Whenever a steerable turn exists, this promotes them to steers from
 * the head of the queue, so nothing waits for a manual "Send now". It stops at the first
 * queued run that is held or did not ask to steer, so queue order is never jumped.
 */
export function nextAutoSteerPromotion(projection: {
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly messages: Parameters<typeof resolveMessageDispatchIntent>[0]["messages"];
  readonly providerTurns: Parameters<typeof resolveMessageDispatchIntent>[0]["providerTurns"];
  readonly providerThreads: Parameters<typeof resolveMessageDispatchIntent>[0]["providerThreads"];
  readonly providerSessions: Parameters<
    typeof resolveMessageDispatchIntent
  >[0]["providerSessions"];
}): { readonly queuedRunId: OrchestrationV2Run["id"]; readonly targetRunId: OrchestrationV2Run["id"] } | null {
  const queued = projection.runs
    .filter((run) => run.status === "queued")
    .toSorted(
      (left, right) =>
        (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
        left.ordinal - right.ordinal,
    );
  const head = queued[0];
  if (head === undefined || head.autoSteer !== true || head.queueHeld === true) return null;
  const activeRun = projection.runs.findLast(isActiveRun);
  if (activeRun === undefined) return null;
  const activeMessage = projection.messages.find(
    (message) => message.id === activeRun.userMessageId,
  );
  // Promote skips a compaction and starts the message, as the manual Steer button does.
  if (activeMessage !== undefined && isCompactionCommandMessage(activeMessage)) {
    return { queuedRunId: head.id, targetRunId: activeRun.id };
  }
  const mode = resolveMessageDispatchIntent(
    projection as Parameters<typeof resolveMessageDispatchIntent>[0],
    { type: "start_immediately" },
    "auto",
  );
  return mode.type === "steer_active" ? { queuedRunId: head.id, targetRunId: mode.targetRunId } : null;
}

const triggers = (event: OrchestrationV2DomainEvent): boolean =>
  (event.type === "provider-turn.updated" && event.payload.status === "running") ||
  ((event.type === "run.created" || event.type === "run.updated") &&
    (event.payload.status === "running" ||
      (event.payload.status === "queued" && event.payload.autoSteer === true)));

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  let sequence = 0;
  // Threads that got a trigger while their pass was running; the pass runs again for them.
  const dirty = new Set<ThreadId>();

  const promote = Effect.fn("AutoSteerQueuedService.promote")(
    function* (threadId: ThreadId) {
      dirty.delete(threadId);
      for (let pass = 0; pass < MAX_PROMOTIONS_PER_PASS; pass++) {
        const records = yield* projections.getThreadRecords(threadId, [
          "runs",
          "messages",
          "providerTurns",
          "providerThreads",
          "providerSessions",
        ]);
        if (records.thread.archivedAt !== null || records.thread.deletedAt !== null) return;
        const next = nextAutoSteerPromotion(records);
        if (next === null) {
          if (!dirty.delete(threadId)) return;
          continue;
        }
        const stamp = DateTime.toEpochMillis(yield* DateTime.now);
        yield* orchestrator.dispatch({
          type: "queued-message.promote-to-steer",
          commandId: CommandId.make(
            `server:auto-steer:${next.queuedRunId}:${stamp}:${++sequence}`,
          ),
          threadId,
          queuedRunId: next.queuedRunId,
          targetRunId: next.targetRunId,
        });
      }
    },
    (effect, threadId) =>
      effect.pipe(
        // A refused steer leaves the run queued; the next turn event tries again.
        Effect.catchCause((cause) =>
          Effect.logDebug("queued send still cannot steer", { threadId, cause }),
        ),
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
