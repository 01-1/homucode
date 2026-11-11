import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as FileSystem from "effect/FileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as CompletionSink from "./CompletionSink.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const threadId = ThreadId.make("completion-thread");
const runId = RunId.make("completion-run");
const provider = ProviderInstanceId.make("codex");
const at = DateTime.makeUnsafe("2026-11-10T22:00:00Z");
const run = (status: OrchestrationV2Run["status"]): OrchestrationV2Run => ({
  id: runId,
  threadId,
  ordinal: 1,
  providerInstanceId: provider,
  modelSelection: { instanceId: provider, model: "gpt-6.1-sol" },
  providerThreadId: null,
  userMessageId: MessageId.make("input"),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  queuePosition: null,
  requestedAt: at,
  startedAt: at,
  completedAt: status === "running" ? null : at,
  checkpointId: null,
  contextHandoffId: null,
});
const event = (id: string, payload: OrchestrationV2Run): OrchestrationV2DomainEvent => ({
  type: "run.updated",
  id: EventId.make(id),
  threadId,
  runId: payload.id,
  occurredAt: at,
  payload,
});
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink.EventSinkV2;
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('completion-project', 'Project', '/workspace', '[]', '2026-11-10', '2026-11-10')`;
  yield* sink.write({
    events: [
      {
        type: "thread.created",
        id: EventId.make("thread-created"),
        threadId,
        occurredAt: at,
        payload: {
          id: threadId,
          projectId: ProjectId.make("completion-project"),
          title: "Completion test",
          providerInstanceId: provider,
          modelSelection: { instanceId: provider, model: "gpt-6.1-sol" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: at,
          updatedAt: at,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
          createdBy: "user",
          creationSource: "web",
        },
      },
      { ...event("run-created", run("running")), type: "run.created" },
      {
        type: "message.updated",
        id: EventId.make("visible-message"),
        threadId,
        runId,
        occurredAt: at,
        payload: {
          id: MessageId.make("visible"),
          threadId,
          runId,
          nodeId: null,
          role: "assistant",
          createdBy: "agent",
          creationSource: "provider",
          text: "Final visible reply",
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      },
      {
        type: "message.updated",
        id: EventId.make("commentary-message"),
        threadId,
        runId,
        occurredAt: at,
        payload: {
          id: MessageId.make("z-commentary"),
          threadId,
          runId,
          nodeId: null,
          role: "assistant",
          createdBy: "agent",
          creationSource: "provider",
          text: "Earlier commentary",
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      },
    ],
  });
  yield* sql`INSERT INTO orchestration_v2_projection_turn_items
    (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
    VALUES ('commentary-item', ${threadId}, ${runId}, 1, 'assistant_message', 'completed', '2026-11-10', '{"messageId":"z-commentary"}'),
           ('final-item', ${threadId}, ${runId}, 2, 'assistant_message', 'completed', '2026-11-10', '{"messageId":"visible"}')`;
  // Non-message payloads must never leak into the completion JSON.
  yield* sql`INSERT INTO orchestration_v2_projection_turn_items
    (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
    VALUES ('reasoning', ${threadId}, ${runId}, 1, 'reasoning', 'completed', '2026-11-10', '{"text":"PRIVATE REASONING"}')`;
});
const infrastructure = EventSink.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(EventStore.layer, ProjectionStore.layer)),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

it.effect(
  "captures outcomes atomically once and retries across worker reconstruction without reasoning or tool output",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const events = yield* EventSink.EventSinkV2;
      yield* seed;
      const calls: Array<ProcessRunner.ProcessRunInput> = [];
      let fail = true;
      let validConfig = false;
      const layer = CompletionSink.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(FileSystem.FileSystem)({
              readFileString: () =>
                Effect.sync(() =>
                  validConfig
                    ? JSON.stringify({
                        completionSink: { command: ["receiver", "append-result", "-"] },
                      })
                    : "{broken",
                ),
            }),
            NodePath.layer,
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: (input) =>
                Effect.sync(() => {
                  calls.push(input);
                  return {
                    stdout: "",
                    stderr: "",
                    code: ChildProcessSpawner.ExitCode(fail ? 1 : 0),
                    timedOut: false,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stdoutInvalidUtf8: false,
                    stderrInvalidUtf8: false,
                  };
                }),
            }),
          ),
        ),
      );
      const drain = Effect.gen(function* () {
        yield* (yield* CompletionSink.CompletionSink).drain();
      }).pipe(Effect.provide(layer));
      const write = events.write({ events: [event("terminal", run("completed"))] });
      yield* sql
        .withTransaction(write.pipe(Effect.andThen(Effect.fail("rollback"))))
        .pipe(Effect.flip);
      assert.lengthOf(yield* sql`SELECT * FROM thread_completion_outbox`, 0);
      yield* write;
      yield* events.write({ events: [event("terminal-again", run("completed"))] });
      assert.lengthOf(yield* sql`SELECT * FROM thread_completion_outbox`, 1);
      yield* drain;
      assert.lengthOf(calls, 0);
      validConfig = true;
      yield* TestClock.adjust("5 seconds");
      yield* drain;
      assert.lengthOf(calls, 1);
      const payload = JSON.parse(calls[0]!.stdin!);
      assert.deepEqual(payload, {
        schema: 1,
        thread_id: threadId,
        run_id: runId,
        project_id: "completion-project",
        title: "Completion test",
        status: "completed",
        created_at: "2026-11-10T22:00:00.000Z",
        text: "Final visible reply",
      });
      yield* drain;
      assert.lengthOf(calls, 1);
      fail = false;
      yield* TestClock.adjust("10 seconds");
      yield* drain;
      assert.lengthOf(calls, 2);
      assert.equal(calls[0]!.stdin, calls[1]!.stdin);
      yield* drain;
      assert.lengthOf(calls, 2);
      let ordinal = 1;
      for (const status of ["failed", "interrupted", "cancelled"] as const) {
        const nextRun = { ...run(status), id: RunId.make(`run-${status}`), ordinal: ++ordinal };
        yield* events.write({ events: [event(`event-${status}`, nextRun)] });
        yield* drain;
        assert.equal(JSON.parse(calls.at(-1)!.stdin!).status, status);
      }
    }).pipe(Effect.provide(infrastructure)),
);
