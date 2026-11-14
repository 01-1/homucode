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
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { reconcileThreadTitleId } from "./threadTitleId.ts";

type ReconcileError =
  | Orchestrator.OrchestratorV2Error
  | ServerSettingsError
  | ThreadManagementService.ThreadManagementProviderInstanceDisabledError;

/**
 * Keeps every thread's title ID in line with its title, settled state and project, so IDs stay
 * unique within a project. It is driven by thread events and kept in memory only: nothing it
 * does is queued in the outbox, so an older build can always read the database back.
 */
export class ThreadTitleIdReconciler extends Context.Service<
  ThreadTitleIdReconciler,
  {
    /** Reconciles one thread against the rest of its project. */
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
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  // One project pass at a time, so two threads can never pick the same free ID.
  const lock = yield* Semaphore.make(1);
  // Command receipts outlive the process, so each run gets its own command IDs.
  const runId = yield* (yield* SecureRandom.SecureRandom).uuidV4();
  let sequence = 0;
  // What each pending ID write was based on, so its own event is not reconciled again.
  const ownWrites = new Map<
    ThreadId,
    { readonly titleId: string | null; readonly title: string; readonly settled: boolean }
  >();

  const reconcileProject = Effect.fn("ThreadTitleIdReconciler.reconcileProject")(function* (
    projectId: ProjectId,
    only: ThreadId | undefined,
  ) {
    const enabled = resolveProjectSettings(yield* serverSettings.getSettings, projectId).settings
      .threadTitleIdPrefix;
    // The active location holds settled threads, side chats and subagents too; archives drop
    // their ID when archived.
    const snapshot = yield* threads.getShellSnapshot({ location: "active", projectId });
    const ids = new Map(snapshot.threads.map((thread) => [thread.id, thread.titleId ?? null]));
    // Newest first, so when two threads share an ID the older one keeps it.
    const ordered = snapshot.threads
      .filter((thread) => only === undefined || thread.id === only)
      .toSorted(
        (a, b) => DateTime.toEpochMillis(b.createdAt) - DateTime.toEpochMillis(a.createdAt),
      );
    for (const thread of ordered) {
      const current = ids.get(thread.id) ?? null;
      const settled = thread.settledOverride === "settled";
      const next = enabled
        ? reconcileThreadTitleId({
            current,
            title: thread.title,
            settled,
            taken: new Set(
              [...ids].flatMap(([id, titleId]) =>
                id !== thread.id && titleId !== null ? [titleId] : [],
              ),
            ),
          })
        : null;
      if (next === current) continue;
      sequence += 1;
      ids.set(thread.id, next);
      ownWrites.set(thread.id, { titleId: next, title: thread.title, settled });
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
        ids.set(thread.id, current);
        ownWrites.delete(thread.id);
      }
    }
  });

  const reconcile: ThreadTitleIdReconciler["Service"]["reconcile"] = Effect.fn(
    "ThreadTitleIdReconciler.reconcile",
  )(function* (threadId) {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const { thread } = yield* threads.getThreadRecords(threadId, []);
        if (thread.archivedAt !== null || thread.deletedAt !== null) return;
        yield* reconcileProject(thread.projectId, threadId);
      }),
    );
  });

  const reconcileAll: ThreadTitleIdReconciler["Service"]["reconcileAll"] = Effect.fn(
    "ThreadTitleIdReconciler.reconcileAll",
  )(function* (projectIds) {
    const snapshot = yield* threads.getShellSnapshot({ location: "active" });
    const all = new Set(snapshot.threads.map((thread) => thread.projectId));
    for (const projectId of all) {
      if (projectIds !== undefined && !projectIds.has(projectId)) continue;
      yield* lock
        .withPermits(1)(reconcileProject(projectId, undefined))
        .pipe(logSkipped(undefined));
    }
  });

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
    const threads = yield* ThreadManagementService.ThreadManagementService;
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
        threads.getShellSnapshot({ location: "active" }).pipe(
          Effect.flatMap((snapshot) => {
            const next = enabledProjects(
              settings,
              snapshot.threads.map((thread) => thread.projectId),
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
        const snapshot = yield* threads.getShellSnapshot({ location: "active" });
        enabled = enabledProjects(
          yield* serverSettings.getSettings,
          snapshot.threads.map((thread) => thread.projectId),
        );
        yield* reconciler.reconcileAll();
      }).pipe(logSkipped(undefined), Effect.ensuring(Deferred.succeed(startupDone, undefined))),
    );
  }),
).pipe(Layer.provide(layer));
