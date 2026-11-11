import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProcessRunner from "../processRunner.ts";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scheduler from "../scheduling/Scheduler.ts";

const Command = Schema.Array(Schema.String).check(Schema.isMinLength(1));
const decodeCommand = Schema.decodeUnknownEffect(Schema.fromJsonString(Command));

export class CompletionSink extends Context.Service<CompletionSink, {
  readonly drain: () => Effect.Effect<void, Schema.SchemaError | import("effect/sql/SqlError").SqlError>;
}>()("t3/orchestration-v2/CompletionSink") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;
  const permit = yield* Semaphore.make(1);
  const drain = Effect.fn("CompletionSink.drain")(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const rows = yield* sql<{
      thread_id: string; run_id: string; workspace_root: string; payload_json: string;
      command_json: string | null; attempts: number;
    }>`SELECT * FROM thread_completion_outbox WHERE delivered = 0 AND next_attempt_at <= ${now}
       ORDER BY next_attempt_at, rowid LIMIT 32`;
    for (const row of rows) {
      let commandJson = row.command_json;
      if (commandJson === null) {
        const config = yield* fs.readFileString(path.join(row.workspace_root, "t3.json")).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(T3ProjectFileFromJson)),
          Effect.result,
        );
        if (config._tag === "Failure") {
          yield* sql`UPDATE thread_completion_outbox SET attempts = attempts + 1, next_attempt_at = ${now + 5000}
            WHERE thread_id = ${row.thread_id} AND run_id = ${row.run_id}`;
          continue;
        }
        const command = config.success.completionSink?.command;
        if (command === undefined) {
          yield* sql`UPDATE thread_completion_outbox SET delivered = 1
            WHERE thread_id = ${row.thread_id} AND run_id = ${row.run_id}`;
          continue;
        }
        commandJson = JSON.stringify(command);
        yield* sql`UPDATE thread_completion_outbox SET command_json = ${commandJson}
          WHERE thread_id = ${row.thread_id} AND run_id = ${row.run_id}`;
      }
      const command = yield* decodeCommand(commandJson);
      // The receiver must durably deduplicate (thread_id, run_id) before acknowledging exit 0.
      const accepted = yield* processes.run({
        command: command[0]!, args: command.slice(1), cwd: row.workspace_root,
        stdin: row.payload_json + "\n", timeout: "30 seconds", maxOutputBytes: 4096,
      }).pipe(Effect.map((result) => result.code === 0 && !result.timedOut),
        Effect.catch(() => Effect.succeed(false)));
      const next = now + Math.min(300_000, 5_000 * 2 ** Math.min(row.attempts, 6));
      yield* sql`UPDATE thread_completion_outbox SET delivered = ${accepted ? 1 : 0},
        attempts = attempts + 1, next_attempt_at = ${next}
        WHERE thread_id = ${row.thread_id} AND run_id = ${row.run_id}`;
    }
  }, permit.withPermits(1));
  return CompletionSink.of({ drain });
});

export const layer = Layer.effect(CompletionSink, make);
export const layerWorker = Layer.effectDiscard(Effect.gen(function* () {
  const sink = yield* CompletionSink;
  const scheduler = yield* Scheduler.Scheduler;
  yield* scheduler.register("thread-completion-sink", sink.drain());
}));
