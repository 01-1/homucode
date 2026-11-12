import { assert, it } from "@effect/vitest";
import {
  CommandId, EnvironmentId, NonNegativeInt, ProjectId,
  ProviderDriverKind, ProviderInstanceId, ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerSettings from "../serverSettings.ts";
import { forkParkedFiber, ServerActivation } from "../serverActivation.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Receipts from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as Registry from "./ProviderAdapterRegistry.ts";
import * as Threads from "./ThreadManagementService.ts";
import * as Harness from "./testkit/ProviderReplayHarness.ts";
import * as Config from "./ProjectRouterNoticeConfig.ts";
import * as Notices from "./ProjectRouterNoticeService.ts";
import * as Store from "./ProjectRouterNoticeStore.ts";

const p = ProjectId.make("router-project-p");
const q = ProjectId.make("router-project-q");
const router = ThreadId.make("router-p");
const otherRouter = ThreadId.make("router-q");
const environmentId = EnvironmentId.make("11111111-1111-4111-8111-111111111111");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId, driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Router notice fixtures must not start a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const database = Sqlite.layerMemory;
const base = Layer.mergeAll(
  database,
  Receipts.layer.pipe(Layer.provide(database)),
  Harness.layerWithRegistry({ name: "project-router-notices" }, Registry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false }),
);
const testLayer = Layer.mergeAll(base, Threads.layer.pipe(
  Layer.provide(Layer.merge(base, ServerSettings.layerTest())),
));

const enabled: Config.Configuration = { schema: 1, enabled: true, bindings: [{ projectId: p, routerThreadId: router }] };

const createThread = Effect.fn("fixture.createThread")(function* (
  id: ThreadId,
  projectId = p,
  extra: Partial<Extract<OrchestrationV2Command, { type: "thread.create" }>> = {},
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const result = yield* orchestrator.dispatch({
    type: "thread.create", commandId: CommandId.make(`create:${id}`), threadId: id,
    projectId, title: `Title ${id}`, modelSelection,
    runtimeMode: "full-access", interactionMode: "default", branch: null, worktreePath: null,
    createdBy: "agent", creationSource: "mcp", ...extra,
  });
  const stored = result.storedEvents.find((item) => item.event.type === "thread.created");
  if (stored === undefined || stored.event.type !== "thread.created") return yield* Effect.die("Missing fixture creation");
  return stored;
});

const fixture = Effect.gen(function* () {
  yield* createThread(router);
  yield* createThread(otherRouter, q);
  const config = yield* Ref.make<Config.Configuration | null>(enabled);
  const native = yield* Notices.makeDelivery;
  const events = yield* EventSink.EventSinkV2;
  const readConfig = Ref.get(config).pipe(Effect.filterOrElse(
    (value): value is Config.Configuration => value !== null,
    () => new Config.ConfigError({ reason: "invalid_configuration" }),
  ));
  const dependencies: Notices.Native = { ...native, events, config: readConfig, environmentId: Effect.succeed(environmentId) };
  const service = yield* Notices.make(dependencies);
  const store = yield* Store.make;
  const sql = yield* SqlClient.SqlClient;
  const rows = sql<Store.Notice>`SELECT * FROM project_router_notices ORDER BY event_sequence`;
  return { config, native, dependencies, service, store, sql, rows };
});

it.effect("strict local config defaults empty/absent content to disabled and rejects ambiguous bindings", () => Effect.gen(function* () {
  assert.deepStrictEqual(yield* Config.decodeConfig(""), Config.disabled);
  assert.deepStrictEqual(yield* Config.decodeConfig("{}"), Config.disabled);
  for (const text of ["{", '{"schema":1,"enabled":"yes","bindings":[]}',
    '{"schema":1,"enabled":true,"bindings":[],"unknown":1}',
    '{"schema":1,"enabled":true,"bindings":[{"projectId":"p","routerThreadId":"r"},{"projectId":"p","routerThreadId":"s"}]}']) {
    assert.isTrue(Result.isFailure(yield* Effect.result(Config.decodeConfig(text))));
  }
}));

it.effect("first valid enable snapshots current high-water once; disable and malformed config never reset it", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* Ref.set(f.config, Config.disabled);
  yield* f.service.tick;
  assert.isNull(yield* f.store.cursor);
  yield* Ref.set(f.config, null);
  yield* f.service.tick;
  assert.isNull(yield* f.store.cursor);
  yield* createThread(ThreadId.make("old-before-enable"));
  yield* Ref.set(f.config, enabled);
  yield* f.service.tick;
  const boundary = yield* f.store.cursor;
  assert.isNotNull(boundary);
  yield* Ref.set(f.config, Config.disabled);
  const created = yield* createThread(ThreadId.make("after-enable-while-disabled"));
  yield* f.service.capture(created);
  yield* Ref.set(f.config, null);
  yield* f.service.tick;
  const state = yield* f.sql<{ first_sequence: number; cursor: number; config_error: string }>`SELECT * FROM project_router_notice_state`;
  assert.strictEqual(state[0]?.first_sequence, boundary);
  assert.strictEqual(state[0]?.cursor, created.sequence);
  assert.strictEqual(state[0]?.config_error, "invalid_configuration");
  assert.strictEqual((yield* f.rows).length, 1);
  yield* Ref.set(f.config, enabled);
  yield* f.service.tick;
  assert.strictEqual((yield* f.rows)[0]?.accepted, 1);
}).pipe(Effect.provide(testLayer)));

it.effect("automatic committed stream excludes pre-enable threads and dispatches a new creation once", () => Effect.gen(function* () {
  const f = yield* fixture;
  const sent = yield* Deferred.make<void>();
  const service = yield* Notices.make({ ...f.dependencies,
    send: (notice) => f.native.send(notice).pipe(Effect.tap(() => Deferred.succeed(sent, undefined))),
  });
  const fiber = yield* Effect.forkScoped(service.run);
  yield* service.ready;
  const created = yield* createThread(ThreadId.make("automatic-new"));
  yield* Deferred.await(sent);
  // Explicitly replay the event through capture: durable event/thread dedup must retain one row.
  yield* service.capture(created);
  yield* service.tick;
  const rows = yield* f.rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]?.accepted, 1);
  assert.strictEqual(rows[0]?.thread_id, "automatic-new");
  yield* Fiber.interrupt(fiber);
}).pipe(Effect.scoped, Effect.provide(testLayer)));

it.effect("parked worker does not read configuration or establish a boundary before activation", () => Effect.gen(function* () {
  const f = yield* fixture;
  let configReads = 0;
  const activation = yield* Deferred.make<void>();
  const service = yield* Notices.make({ ...f.dependencies,
    config: Effect.sync(() => { configReads++; return enabled; }),
  });
  const fiber = yield* forkParkedFiber(service.run).pipe(
    Effect.provideService(ServerActivation, Deferred.await(activation)),
  );
  assert.strictEqual(configReads, 0);
  assert.isNull(yield* f.store.cursor);
  yield* Deferred.succeed(activation, undefined);
  yield* service.ready;
  assert.isAbove(configReads, 0);
  assert.isNotNull(yield* f.store.cursor);
  yield* Fiber.interrupt(fiber);
}).pipe(Effect.scoped, Effect.provide(testLayer)));

it.effect("restart catches up post-boundary committed creations while delivery was disabled", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* f.service.tick;
  const boundary = yield* f.store.cursor;
  yield* Ref.set(f.config, Config.disabled);
  // No capture callback runs: this event must be recovered from the committed stream.
  const created = yield* createThread(ThreadId.make("offline-catchup"));
  yield* Ref.set(f.config, enabled);
  const sent = yield* Deferred.make<void>();
  const restarted = yield* Notices.make({ ...f.dependencies,
    send: (notice) => f.native.send(notice).pipe(Effect.tap(() => Deferred.succeed(sent, undefined))),
  });
  const fiber = yield* Effect.forkScoped(restarted.run);
  yield* Deferred.await(sent);
  yield* restarted.tick;
  const rows = yield* f.rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]?.event_id, created.event.id);
  assert.strictEqual(rows[0]?.accepted, 1);
  const state = yield* f.sql<{ first_sequence: number }>`SELECT first_sequence FROM project_router_notice_state`;
  assert.strictEqual(state[0]?.first_sequence, boundary);
  yield* Fiber.interrupt(fiber);
}).pipe(Effect.scoped, Effect.provide(testLayer)));

it.effect("common creation event includes a real fork of v1 history and omits inherited ancestry", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* f.service.tick;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* f.sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.historyOrigin', 'v1_import') WHERE thread_id = ${router}`;
  const result = yield* orchestrator.dispatch({
    type: "thread.fork", commandId: CommandId.make("fork-new-router-notice"),
    sourceThreadId: router, targetThreadId: ThreadId.make("new-fork"),
    sourcePoint: { type: "latest_stable" }, sideChat: true,
    createdBy: "agent", creationSource: "mcp",
  });
  const forkCreation = result.storedEvents.find((stored) => stored.event.type === "thread.created");
  assert.strictEqual(forkCreation?.event.type === "thread.created" ? forkCreation.event.payload.historyOrigin : undefined, "v1_import");
  for (const stored of result.storedEvents) yield* f.service.capture(stored);
  yield* f.service.tick;
  const rows = yield* f.rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]?.thread_id, "new-fork");
  assert.strictEqual(rows[0]?.accepted, 1);
  assert.isFalse(rows[0]?.body?.includes("parent") ?? true);
}).pipe(Effect.provide(testLayer)));

it.effect("missing router stays owed; foreign router cannot construct/pin a body or receive metadata", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* f.service.tick;
  yield* Ref.set(f.config, { ...enabled, bindings: [] });
  yield* f.service.capture(yield* createThread(ThreadId.make("unbound")));
  yield* f.service.tick;
  assert.strictEqual((yield* f.rows)[0]?.last_error, "missing_router");
  assert.isNull((yield* f.rows)[0]?.body);
  yield* Ref.set(f.config, { ...enabled, bindings: [{ projectId: p, routerThreadId: otherRouter }] });
  yield* f.service.tick;
  const held = (yield* f.rows)[0];
  assert.strictEqual(held?.last_error, "router_ineligible");
  assert.isNull(held?.body);
  assert.isNull(held?.command_id);
  yield* Ref.set(f.config, enabled);
  yield* f.service.tick;
  assert.strictEqual((yield* f.rows)[0]?.router_thread_id, router);
  assert.strictEqual((yield* f.rows)[0]?.accepted, 1);
}).pipe(Effect.provide(testLayer)));

it.effect("explicit project bindings isolate notices; no MAIN fallback or parent ancestry", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* Ref.set(f.config, { ...enabled, bindings: [...enabled.bindings, { projectId: q, routerThreadId: otherRouter }] });
  yield* f.service.tick;
  for (const [name, project] of [["own-p", p], ["own-q", q]] as const) {
    const stored = yield* createThread(ThreadId.make(name), project);
    if (stored.event.type !== "thread.created") return yield* Effect.die("Missing creation");
    yield* f.service.capture({ ...stored, event: { ...stored.event, payload: { ...stored.event.payload,
      lineage: { parentThreadId: ThreadId.make("FOREIGN-PRIVATE-PARENT"), relationshipToParent: "subagent", rootThreadId: ThreadId.make("FOREIGN-PRIVATE-ROOT") },
    } } });
  }
  yield* f.service.tick;
  const rows = yield* f.rows;
  assert.deepStrictEqual(rows.map((row) => row.router_thread_id), [router, otherRouter]);
  for (const row of rows) {
    assert.isFalse(row.body?.includes("FOREIGN-PRIVATE") ?? true);
    assert.isFalse(row.body?.includes("parent") ?? true);
    assert.include(row.body ?? "", '"createdBy":"agent"');
  }
}).pipe(Effect.provide(testLayer)));

it.effect("unknown send without acceptance retries original body and IDs; binding updates never retarget", () => Effect.gen(function* () {
  const f = yield* fixture;
  const attempts: Store.BoundNotice[] = [];
  const service = yield* Notices.make({ ...f.dependencies, send: (notice) => {
    attempts.push(notice);
    return Effect.fail("transport_unknown");
  } });
  yield* service.tick;
  yield* service.capture(yield* createThread(ThreadId.make("retry-identity")));
  yield* service.tick;
  const original = (yield* f.rows)[0]!;
  yield* Ref.set(f.config, { ...enabled, bindings: [{ projectId: p, routerThreadId: otherRouter }] });
  yield* service.tick;
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual((yield* f.rows)[0]?.last_error, "binding_changed");
  yield* Ref.set(f.config, enabled);
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({ type: "thread.metadata.update", commandId: CommandId.make("rename-retry"), threadId: ThreadId.make("retry-identity"), title: "RENAMED AFTER CREATION" });
  yield* service.tick;
  assert.strictEqual(attempts.length, 2);
  assert.strictEqual(attempts[0]?.body, attempts[1]?.body);
  assert.strictEqual(attempts[0]?.command_id, attempts[1]?.command_id);
  assert.strictEqual(attempts[0]?.message_id, attempts[1]?.message_id);
  assert.strictEqual((yield* f.rows)[0]?.body, original.body);
  assert.isFalse(original.body?.includes("RENAMED") ?? true);
}).pipe(Effect.provide(testLayer)));

for (const change of ["projectId", "archivedAt", "deletedAt"] as const) {
  it.effect(`accepted original receipt reconciles after ${change} changes without another send`, () => Effect.gen(function* () {
    const f = yield* fixture;
    let sends = 0;
    const service = yield* Notices.make({ ...f.dependencies, send: (notice) => Effect.gen(function* () {
      sends++;
      yield* f.native.send(notice);
      return yield* Effect.fail("lost_after_native_acceptance");
    }) });
    yield* service.tick;
    yield* service.capture(yield* createThread(ThreadId.make(`accepted-${change}`)));
    yield* service.tick;
    assert.strictEqual((yield* f.rows)[0]?.accepted, 0);
    const replacement = change === "projectId" ? q : "2026-11-12T01:00:00.000Z";
    yield* f.sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, ${`$.${change}`}, ${replacement}) WHERE thread_id = ${router}`;
    yield* Ref.set(f.config, { ...enabled, bindings: [] });
    yield* service.tick;
    assert.strictEqual(sends, 1);
    assert.strictEqual((yield* f.rows)[0]?.accepted, 1);
  }).pipe(Effect.provide(testLayer)));
}

for (const receiptStatus of ["accepted", "rejected"] as const) {
  it.effect(`${receiptStatus} receipt without original message proof holds rather than resending`, () => Effect.gen(function* () {
    const f = yield* fixture;
    const receipts = yield* Receipts.CommandReceiptStoreV2;
    let sends = 0;
    const service = yield* Notices.make({ ...f.dependencies, send: (notice) => Effect.gen(function* () {
      sends++;
      // Deliberately incomplete receipt fixture: no matching native message event exists.
      yield* receipts.insertIfAbsent({
        commandId: CommandId.make(notice.command_id), threadId: router,
        commandType: "message.dispatch", acceptedAt: yield* DateTime.now,
        resultSequence: NonNegativeInt.make(0), status: receiptStatus, error: receiptStatus === "rejected" ? "fixture rejection" : null,
      });
      return yield* Effect.fail("lost_reply");
    }) });
    yield* service.tick;
    yield* service.capture(yield* createThread(ThreadId.make("unverified-proof")));
    yield* service.tick;
    yield* service.tick;
    assert.strictEqual(sends, 1);
    assert.strictEqual((yield* f.rows)[0]?.last_error, receiptStatus === "accepted" ? "receipt_unverified" : "receipt_rejected");
    assert.strictEqual((yield* f.rows)[0]?.accepted, 0);
  }).pipe(Effect.provide(testLayer)));

}

it.effect("v1 history and actual native import command are excluded while genuine creation remains", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* f.service.tick;
  const v1 = yield* createThread(ThreadId.make("materialized-v1"));
  if (v1.event.type !== "thread.created") return yield* Effect.die("Missing creation");
  yield* f.service.capture({ ...v1, event: { ...v1.event, payload: { ...v1.event.payload, historyOrigin: "v1_import" } } });
  const imported = yield* createThread(ThreadId.make("native-import"), p, {
    importedNativeThread: { ref: { driver: adapter.driver, nativeId: "existing-native-history", strength: "strong" } },
  });
  yield* f.service.capture(imported);
  const genuine = yield* createThread(ThreadId.make("new-native-child"), p, { creationSource: "provider" });
  yield* f.service.capture(genuine);
  yield* f.service.tick;
  assert.deepStrictEqual((yield* f.rows).map((row) => row.thread_id), ["new-native-child"]);
  assert.strictEqual(yield* f.store.cursor, genuine.sequence);
}).pipe(Effect.provide(testLayer)));

for (const field of ["projectId", "archivedAt", "deletedAt", "settledAt"] as const) {
  it.effect(`real normal send propagates transaction guard; ${field} race rolls back receipt/events/effects/state`, () => Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.service.tick;
    yield* f.service.capture(yield* createThread(ThreadId.make(`race-${field}`)));
    const beforeEvents = yield* f.sql`SELECT * FROM orchestration_events ORDER BY sequence`;
    const beforeEffects = yield* f.sql`SELECT * FROM orchestration_v2_effect_outbox`;
    const beforeContinuity = yield* f.sql`SELECT * FROM work_assistance_continuity`;
    const beforeThread = yield* f.sql`SELECT * FROM orchestration_v2_projection_threads WHERE thread_id = ${router}`;
    // A real SQLite trigger injects the change AFTER sendToThread's project read,
    // at receipt reservation inside the normal EventSink transaction. No provider worker.
    const value = field === "projectId" ? q : "2026-11-12T01:00:00.000Z";
    yield* f.sql.unsafe(`CREATE TRIGGER router_race BEFORE INSERT ON orchestration_command_receipts
      WHEN NEW.command_id LIKE 'project-router-notice:v1:%'
      BEGIN UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.${field}', '${value}') WHERE thread_id = 'router-p'; END`);
    yield* f.service.tick;
    const notice = (yield* f.rows)[0]!;
    assert.strictEqual(notice.accepted, 0);
    assert.strictEqual(notice.last_error, "delivery_unknown");
    assert.isTrue(Store.isBound(notice));
    assert.deepStrictEqual(yield* f.sql`SELECT * FROM orchestration_events ORDER BY sequence`, beforeEvents);
    assert.deepStrictEqual(yield* f.sql`SELECT * FROM orchestration_v2_effect_outbox`, beforeEffects);
    assert.deepStrictEqual(yield* f.sql`SELECT * FROM work_assistance_continuity`, beforeContinuity);
    assert.deepStrictEqual(yield* f.sql`SELECT * FROM orchestration_v2_projection_threads WHERE thread_id = ${router}`, beforeThread);
    assert.strictEqual((yield* f.sql`SELECT 1 FROM orchestration_command_receipts WHERE command_id = ${notice.command_id}`).length, 0);
  }).pipe(Effect.provide(testLayer)));
}

it.effect("unbound capture survives service recreation and more than one delivery page without dropping IDs", () => Effect.gen(function* () {
  const f = yield* fixture;
  yield* Ref.set(f.config, { ...enabled, bindings: [] });
  yield* f.service.tick;
  for (let i = 0; i < 105; i++) yield* f.service.capture(yield* createThread(ThreadId.make(`burst-${i}`)));
  yield* f.service.tick;
  assert.strictEqual((yield* f.rows).length, 105);
  const sent = new Set<string>();
  const restarted = yield* Notices.make({ ...f.dependencies, send: (notice) => Effect.sync(() => { sent.add(notice.event_id); }) });
  yield* Ref.set(f.config, enabled);
  yield* restarted.tick;
  yield* restarted.tick;
  assert.strictEqual(sent.size, 105);
  assert.strictEqual((yield* f.rows).filter((row) => row.accepted === 1).length, 105);
}).pipe(Effect.provide(testLayer)));
