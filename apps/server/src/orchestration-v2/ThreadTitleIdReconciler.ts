import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { CommandId, type ServerSettingsError, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { reconcileThreadTitleId } from "./threadTitleId.ts";

/**
 * Keeps every thread's title ID in line with its title, settled state and project, so IDs stay
 * unique within a project. It is driven by thread events and kept in memory only: nothing it
 * does is queued in the outbox, so an older build can always read the database back.
 */
export class ThreadTitleIdReconciler extends Context.Service<
  ThreadTitleIdReconciler,
  {
    readonly reconcile: (
      threadId: ThreadId,
    ) => Effect.Effect<
      void,
      | Orchestrator.OrchestratorV2Error
      | ServerSettingsError
      | ThreadManagementService.ThreadManagementProviderInstanceDisabledError
    >;
  }
>()("t3/orchestration-v2/ThreadTitleIdReconciler") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  // One thread at a time, so two threads can never pick the same free ID.
  const lock = yield* Semaphore.make(1);
  let sequence = 0;

  const reconcile: ThreadTitleIdReconciler["Service"]["reconcile"] = Effect.fn(
    "ThreadTitleIdReconciler.reconcile",
  )(function* (threadId) {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const { thread } = yield* threads.getThreadRecords(threadId, []);
        if (thread.archivedAt !== null || thread.deletedAt !== null) return;
        const current = thread.titleId ?? null;
        const settings = resolveProjectSettings(
          yield* serverSettings.getSettings,
          thread.projectId,
        ).settings;
        let next: string | null = null;
        if (settings.threadTitleIdPrefix) {
          // The active location holds settled threads, side chats and subagents too.
          const snapshot = yield* threads.getShellSnapshot({
            location: "active",
            projectId: thread.projectId,
          });
          const taken = new Set(
            snapshot.threads.flatMap((other) =>
              other.id !== threadId && other.titleId != null ? [other.titleId] : [],
            ),
          );
          next = reconcileThreadTitleId({
            current,
            title: thread.title,
            settled: thread.settledOverride === "settled",
            taken,
          });
        }
        if (next === current) return;
        sequence += 1;
        yield* threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`server:title-id:${threadId}:${next ?? "none"}:${sequence}`),
          threadId,
          titleId: next,
        });
      }),
    );
  });

  return ThreadTitleIdReconciler.of({ reconcile });
});

export const layer = Layer.effect(ThreadTitleIdReconciler, make);

const logSkipped = (threadId: ThreadId | undefined) =>
  Effect.catchCauseIf(
    (cause: Cause.Cause<unknown>) => !Cause.hasInterruptsOnly(cause),
    (cause) => Effect.logWarning("thread title ID reconcile skipped", { threadId, cause }),
  );

/** Reconciles a thread after each of its events, and every thread when settings change. */
export const layerReactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const reconciler = yield* ThreadTitleIdReconciler;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type.startsWith("thread.") && event.type !== "thread.deleted"
          ? reconciler.reconcile(event.threadId).pipe(logSkipped(event.threadId))
          : Effect.void,
      ).pipe(logSkipped(undefined)),
    );
    // Turning IDs on or off applies to existing threads without waiting for their next event.
    const settingsChanges = yield* serverSettings.subscribeChanges;
    yield* forkParked(
      Stream.runForEach(settingsChanges, () =>
        threads.getShellSnapshot({ location: "active" }).pipe(
          Effect.flatMap((snapshot) =>
            Effect.forEach(
              snapshot.threads,
              (thread) => reconciler.reconcile(thread.id).pipe(logSkipped(thread.id)),
              { discard: true },
            ),
          ),
          logSkipped(undefined),
        ),
      ),
    );
  }),
).pipe(Layer.provide(layer));
