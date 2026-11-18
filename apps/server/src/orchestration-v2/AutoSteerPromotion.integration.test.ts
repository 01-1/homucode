import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderTurnId,
  ThreadId,
  TurnItemId,
  OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import type * as Adapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Sqlite from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Events from "./EventSink.ts";
import * as Outbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as Projections from "./ProjectionStore.ts";
import * as Registry from "./ProviderAdapterRegistry.ts";
import * as Sessions from "./ProviderSessionManager.ts";
import * as Replay from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex"),
  driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter: Adapter.ProviderAdapterV2["Service"] = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: (input) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      // The real manager owns this runtime. Provider effects stay undrained so the
      // test inspects the promotion transaction independently of delivery.
      return {
        instanceId,
        driver,
        providerSessionId: input.providerSessionId,
        providerSession: {
          id: input.providerSessionId,
          driver,
          providerInstanceId: instanceId,
          status: "ready",
          cwd: input.runtimePolicy.cwd ?? "/tmp",
          model: input.modelSelection.model,
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        },
        events: Stream.never,
        ensureThread: () => Effect.die("unused ensureThread"),
        resumeThread: () => Effect.die("unused resumeThread"),
        startTurn: () => Effect.die("provider start effect is not drained"),
        steerTurn: () => Effect.die("provider steer effect is not drained"),
        interruptTurn: () => Effect.die("unused interruptTurn"),
        respondToRuntimeRequest: () => Effect.die("unused runtime request"),
        readThreadSnapshot: () => Effect.die("unused snapshot"),
        rollbackThread: () => Effect.die("unused rollback"),
        forkThread: () => Effect.die("unused fork"),
      } satisfies Adapter.ProviderAdapterV2SessionRuntime;
    }),
};
const database = Sqlite.layerMemory;
const layer = Layer.mergeAll(
  Projections.layer.pipe(Layer.provide(database)),
  Outbox.layer.pipe(Layer.provide(database)),
  Replay.layerWithRegistry(
    { name: "automatic-promotion-recheck" },
    Registry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);

const decodeEvent = Schema.decodeEffect(OrchestrationV2DomainEvent);

const setup = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2,
    store = yield* Projections.ProjectionStoreV2;
  const events = yield* Events.EventSinkV2;
  const threadId = ThreadId.make("thread:auto-promotion"),
    now = yield* DateTime.now;
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create:auto-promotion"),
    threadId,
    projectId: ProjectId.make("project:auto-promotion"),
    title: "Promotion",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  for (const key of ["active", "first", "second"])
    yield* engine.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`send:auto-promotion:${key}`),
      threadId,
      messageId: MessageId.make(`message:auto-promotion:${key}`),
      text: key,
      attachments: [],
      dispatchMode: { type: key === "active" ? "start_immediately" : "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
  const p = yield* store.getThreadProjection(threadId);
  const active = p.runs.find((run) => run.ordinal === 1)!,
    first = p.runs.find((run) => run.ordinal === 2)!,
    second = p.runs.find((run) => run.ordinal === 3)!;
  const attempt = p.attempts.find((row) => row.id === active.activeAttemptId)!,
    node = p.nodes.find((row) => row.id === active.rootNodeId)!;
  const providerThread = p.providerThreads.find((row) => row.id === active.providerThreadId)!;
  assert.ok(active);
  assert.ok(first);
  assert.ok(second);
  assert.ok(attempt);
  assert.ok(node);
  assert.ok(providerThread);
  const runtime = yield* (yield* Sessions.ProviderSessionManagerV2).open({
    threadId,
    providerSessionId: ProviderSessionId.make("session:auto-promotion"),
    modelSelection,
    runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: "/tmp" },
  });
  const session = runtime.providerSession;
  const turnId = ProviderTurnId.make("provider-turn:auto-promotion");
  let serial = 0;
  const event = <E extends OrchestrationV2DomainEvent>(value: Omit<E, "id">): E =>
    ({ ...value, id: EventId.make(`event:auto-promotion:${++serial}`) }) as E;
  const base = { threadId, providerInstanceId: instanceId, occurredAt: now };
  const seededEvents = [
    event({ ...base, type: "provider-session.updated", payload: { ...session, status: "ready" } }),
    event({
      ...base,
      type: "provider-thread.updated",
      payload: {
        ...providerThread,
        providerSessionId: session.id,
        status: "active",
        nativeThreadRef: { driver, nativeId: "native:auto-promotion", strength: "strong" },
      },
    }),
    event({
      ...base,
      type: "run.updated",
      runId: active.id,
      payload: { ...active, status: "running", startedAt: now },
    }),
    event({
      ...base,
      type: "run-attempt.updated",
      runId: active.id,
      payload: { ...attempt, status: "running", startedAt: now, providerTurnId: turnId },
    }),
    event({
      ...base,
      type: "node.updated",
      runId: active.id,
      nodeId: node.id,
      payload: { ...node, status: "running", startedAt: now, providerTurnId: turnId },
    }),
    event({
      ...base,
      type: "provider-turn.updated",
      runId: active.id,
      nodeId: node.id,
      payload: {
        id: turnId,
        providerThreadId: providerThread.id,
        nodeId: node.id,
        runAttemptId: attempt.id,
        nativeTurnRef: { driver, nativeId: "turn:auto-promotion", strength: "strong" },
        ordinal: 1,
        status: "running",
        startedAt: now,
        completedAt: null,
      },
    }),
  ];
  // Validate each complete event before the production EventStore append.
  const checkedEvents = yield* Effect.forEach(seededEvents, (value) => decodeEvent(value));
  yield* events.writeWithEffects({ events: checkedEvents, effects: [] });
  const ready = yield* store.getThreadProjection(threadId);
  assert.equal(ready.providerSessions.find((row) => row.id === session.id)?.status, "ready");
  assert.equal(
    ready.providerThreads.find((row) => row.id === providerThread.id)?.providerSessionId,
    session.id,
  );
  assert.isTrue(yield* (yield* Sessions.ProviderSessionManagerV2).isLive(session.id));
  assert.equal(ready.providerTurns.find((row) => row.id === turnId)?.status, "running");
  return {
    engine,
    store,
    events,
    threadId,
    active,
    first,
    second,
    event,
    base,
    session,
    node,
    providerThread,
    turnId,
    now,
  };
});

it.effect.each(["reordered", "head-held", "tail-held", "no-opt-in", "compacting"] as const)(
  "refuses automatic promotion after %s without consuming queued input",
  (scenario) =>
    Effect.gen(function* () {
      const f = yield* setup;
      if (scenario === "reordered")
        yield* f.engine.dispatch({
          type: "queued-run.reorder",
          commandId: CommandId.make("reorder:auto-promotion"),
          threadId: f.threadId,
          runId: f.second.id,
          beforeRunId: f.first.id,
        });
      if (scenario === "head-held" || scenario === "tail-held") {
        const held = scenario === "head-held" ? f.first : f.second;
        yield* f.events.writeWithEffects({
          events: [
            f.event({
              ...f.base,
              type: "run.updated",
              runId: held.id,
              payload: { ...held, queueHeld: true },
            }),
          ],
          effects: [],
        });
      }
      // An automatic compaction on a provider whose steers would break it holds an opted-in run.
      if (scenario === "compacting")
        yield* f.events.writeWithEffects({
          events: yield* Effect.forEach(
            [
              f.event({
                ...f.base,
                type: "run.updated",
                runId: f.first.id,
                payload: { ...f.first, autoSteer: true },
              }),
              f.event({
                ...f.base,
                type: "provider-session.updated",
                payload: {
                  ...f.session,
                  capabilities: {
                    ...CodexProviderCapabilitiesV2,
                    turns: {
                      ...CodexProviderCapabilitiesV2.turns,
                      activeSteeringDuringCompaction: false,
                    },
                  },
                },
              }),
              f.event({
                ...f.base,
                type: "turn-item.updated",
                runId: f.active.id,
                nodeId: f.node.id,
                payload: {
                  id: TurnItemId.make("item:auto-promotion:compaction"),
                  threadId: f.threadId,
                  runId: f.active.id,
                  nodeId: f.node.id,
                  providerThreadId: f.providerThread.id,
                  providerTurnId: f.turnId,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: 100,
                  status: "running",
                  title: null,
                  startedAt: f.now,
                  completedAt: null,
                  updatedAt: f.now,
                  type: "compaction",
                  driver,
                },
              }),
            ],
            (value) => decodeEvent(value),
          ),
          effects: [],
        });
      const before = yield* f.store.getThreadProjection(f.threadId);
      const commandId = CommandId.make(`server:auto-steer:${scenario}`);
      const result = yield* f.engine
        .dispatch({
          type: "queued-message.promote-to-steer",
          commandId,
          threadId: f.threadId,
          queuedRunId: f.first.id,
          targetRunId: f.active.id,
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      assert.match(
        JSON.stringify(result),
        scenario === "reordered"
          ? /queue head/
          : scenario === "no-opt-in"
            ? /auto-steer opt-in/
            : scenario === "compacting"
              ? /can take a steer/
              : /held queue/,
      );
      const after = yield* f.store.getThreadProjection(f.threadId);
      assert.deepEqual(after.runs, before.runs);
      assert.deepEqual(after.attempts, before.attempts);
      assert.deepEqual(after.nodes, before.nodes);
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(yield* (yield* Outbox.EffectOutboxV2).listByCommandId(commandId), []);
    }).pipe(Effect.provide(layer)),
);

it.effect("manual promotion still consumes ordinary input without automatic opt-in", () =>
  Effect.gen(function* () {
    const f = yield* setup;
    yield* f.engine.dispatch({
      type: "queued-message.promote-to-steer",
      commandId: CommandId.make("manual:steer-button"),
      threadId: f.threadId,
      queuedRunId: f.first.id,
      targetRunId: f.active.id,
    });
    const after = yield* f.store.getThreadProjection(f.threadId);
    assert.equal(after.runs.find((run) => run.id === f.first.id)!.status, "cancelled");
    assert.equal(
      after.messages.find((message) => message.id === f.first.userMessageId)!.runId,
      f.active.id,
    );
  }).pipe(Effect.provide(layer)),
);
