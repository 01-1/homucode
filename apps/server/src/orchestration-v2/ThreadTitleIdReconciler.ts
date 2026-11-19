import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type ServerSettings as ServerSettingsValue,
  type ServerSettingsError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import { ProjectionStoreV2, type ProjectionStoreV2Error } from "./ProjectionStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { reconcileThreadTitleId } from "./threadTitleId.ts";

type ReconcileError =
  | Orchestrator.OrchestratorV2Error
  | ProjectionStoreV2Error
  | ServerSettingsError
  | ThreadManagementService.ThreadManagementProviderInstanceDisabledError;

/**
 * Keeps every thread's title ID in line with its title, settled state and project, so IDs stay
 * unique across the server. It is driven by thread events and kept in memory only: nothing it
 * does is queued in the outbox, so an older build can always read the database back.
 */
export class ThreadTitleIdReconciler extends Context.Service<
  ThreadTitleIdReconciler,
  {
    /** Reconciles one thread against every assigned title ID. */
    readonly reconcile: (threadId: ThreadId) => Effect.Effect<void, ReconcileError>;
    /** Reconciles every active thread in the given projects, or in all projects. */
    readonly reconcileAll: (
      projectIds?: ReadonlySet<ProjectId>,
    ) => Effect.Effect<void, ReconcileError>;
    /** Whether an event is this reconciler's own ID write, which needs no further reconcile. */
    readonly isOwnWrite: (event: OrchestrationV2DomainEvent) => boolean;
  }
>()("t3/orchestration-v2/ThreadTitleIdReconciler") {}

const logSkipped =
  (threadId: ThreadId | undefined) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => Effect.logWarning("thread title ID reconcile skipped", { threadId, cause }),
      ),
    );

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projection = yield* ProjectionStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  // Keep startup and settings passes from making decisions from each other's partial results.
  const lock = yield* Semaphore.make(1);
  // Command receipts outlive the process, so each run gets its own command IDs.
  const runId = yield* (yield* SecureRandom.SecureRandom).uuidV4();
  let sequence = 0;
  // What each pending ID write was based on, so its own event is not reconciled again.
  const ownWrites = new Map<
    ThreadId,
    { readonly titleId: string | null; readonly title: string; readonly settled: boolean }
  >();

  const reconcileThreads = Effect.fn("ThreadTitleIdReconciler.reconcileThreads")(function* (
    threadId?: ThreadId,
    projectIds?: ReadonlySet<ProjectId>,
  ) {
    const rows = yield* projection.listActiveThreadTitles();
    const projects = new Set(rows.map((thread) => thread.projectId));
    const enabled = enabledProjects(yield* serverSettings.getSettings, projects);
    const taken = new Map<string, number>();
    const reserve = (id: string) => taken.set(id, (taken.get(id) ?? 0) + 1);
    for (const { titleId } of rows) if (titleId !== null) reserve(titleId);
    // Newest first, so when two threads share an ID the older one keeps it.
    for (const thread of rows) {
      if (threadId !== undefined && thread.id !== threadId) continue;
      if (projectIds !== undefined && !projectIds.has(thread.projectId)) continue;
      const { title, titleId: current, settled } = thread;
      if (current !== null) {
        const count = taken.get(current) ?? 0;
        if (count === 1) taken.delete(current);
        else taken.set(current, count - 1);
      }
      const next = enabled.get(thread.projectId)
        ? reconcileThreadTitleId({ current, title, settled, taken })
        : null;
      if (next !== null) reserve(next);
      if (next === current) continue;
      sequence += 1;
      ownWrites.set(thread.id, { titleId: next, title, settled });
      const written = yield* threads
        .dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`server:title-id:${runId}:${sequence}`),
          threadId: thread.id,
          titleId: next,
        })
        .pipe(
          Effect.as(true),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("thread title ID write failed", {
                threadId: thread.id,
                cause,
              }).pipe(Effect.as(false)),
          ),
        );
      if (!written) {
        if (next !== null) taken.delete(next);
        if (current !== null) reserve(current);
        ownWrites.delete(thread.id);
      }
    }
  });

  const reconcile: ThreadTitleIdReconciler["Service"]["reconcile"] = Effect.fn(
    "ThreadTitleIdReconciler.reconcile",
  )((threadId) => lock.withPermits(1)(reconcileThreads(threadId)));

  const reconcileAll: ThreadTitleIdReconciler["Service"]["reconcileAll"] = Effect.fn(
    "ThreadTitleIdReconciler.reconcileAll",
  )((projectIds) => lock.withPermits(1)(reconcileThreads(undefined, projectIds)));

  const isOwnWrite: ThreadTitleIdReconciler["Service"]["isOwnWrite"] = (event) => {
    if (event.type !== "thread.metadata-updated") return false;
    const write = ownWrites.get(event.threadId);
    const thread = event.payload;
    if (write === undefined || write.titleId !== (thread.titleId ?? null)) return false;
    ownWrites.delete(event.threadId);
    return (
      write.title === thread.title &&
      write.settled === (thread.settledOverride === "settled") &&
      thread.archivedAt === null
    );
  };

  return ThreadTitleIdReconciler.of({ reconcile, reconcileAll, isOwnWrite });
});

export const layer = Layer.effect(ThreadTitleIdReconciler, make);

/** Which projects have IDs turned on, for every project with active threads. */
const enabledProjects = (settings: ServerSettingsValue, projectIds: Iterable<ProjectId>) =>
  new Map(
    [...projectIds].map((projectId) => [
      projectId,
      resolveProjectSettings(settings, projectId).settings.threadTitleIdPrefix,
    ]),
  );

/**
 * Reconciles every thread at startup, a thread after each of its events, and a project when its
 * ID setting changes.
 */
export const layerReactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const projection = yield* ProjectionStoreV2;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const reconciler = yield* ThreadTitleIdReconciler;
    // Events wait for the startup pass, so it decides which of two threads sharing an ID keeps it.
    const startupDone = yield* Deferred.make<void>();
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type.startsWith("thread.") &&
        event.type !== "thread.deleted" &&
        !reconciler.isOwnWrite(event)
          ? Deferred.await(startupDone).pipe(
              Effect.andThen(reconciler.reconcile(event.threadId)),
              logSkipped(event.threadId),
            )
          : Effect.void,
      ).pipe(logSkipped(undefined)),
    );
    const settingsChanges = yield* serverSettings.subscribeChanges;
    let enabled = new Map<ProjectId, boolean>();
    yield* forkParked(
      Stream.runForEach(settingsChanges, (settings) =>
        projection.listActiveThreadTitles().pipe(
          Effect.flatMap((rows) => {
            const next = enabledProjects(
              settings,
              rows.map((thread) => thread.projectId),
            );
            const changed = new Set(
              [...next].flatMap(([projectId, on]) =>
                enabled.get(projectId) === on ? [] : [projectId],
              ),
            );
            enabled = next;
            return changed.size === 0 ? Effect.void : reconciler.reconcileAll(changed);
          }),
          logSkipped(undefined),
        ),
      ),
    );
    // Startup: give existing threads their IDs and repair anything a shutdown left half done.
    yield* forkParked(
      Effect.gen(function* () {
        const rows = yield* projection.listActiveThreadTitles();
        enabled = enabledProjects(
          yield* serverSettings.getSettings,
          rows.map((thread) => thread.projectId),
        );
        yield* reconciler.reconcileAll();
      }).pipe(logSkipped(undefined), Effect.ensuring(Deferred.succeed(startupDone, undefined))),
    );
  }),
).pipe(Layer.provide(layer));
