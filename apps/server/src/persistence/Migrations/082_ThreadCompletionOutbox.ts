import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE thread_completion_outbox (
    thread_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    command_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id, run_id)
  )`;
  yield* sql`CREATE INDEX thread_completion_due ON thread_completion_outbox(delivered, next_attempt_at)`;
});
