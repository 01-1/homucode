import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE work_assistance_continuity (
    thread_id TEXT PRIMARY KEY,
    run_id TEXT,
    provider_session_id TEXT,
    detached_session_id TEXT,
    continuous_working_since TEXT
  )`;
  yield* sql`CREATE TABLE work_assistance_launches (
    target_thread_id TEXT NOT NULL, target_run_id TEXT NOT NULL, origin TEXT NOT NULL,
    task_id TEXT NOT NULL, child_thread_id TEXT NOT NULL, child_run_id TEXT NOT NULL,
    PRIMARY KEY (target_thread_id, target_run_id, origin)
  )`;
});
