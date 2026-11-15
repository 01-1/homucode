import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS project_router_notice_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    first_sequence INTEGER,
    cursor INTEGER,
    config_error TEXT
  )`;
  yield* sql`INSERT OR IGNORE INTO project_router_notice_state(id) VALUES (1)`;
  yield* sql`CREATE TABLE IF NOT EXISTS project_router_notices (
    event_id TEXT PRIMARY KEY,
    event_sequence INTEGER NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    thread_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    creator TEXT NOT NULL,
    created_at TEXT NOT NULL,
    router_thread_id TEXT,
    command_id TEXT UNIQUE,
    message_id TEXT UNIQUE,
    body TEXT,
    accepted INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt INTEGER NOT NULL DEFAULT 0,
    CHECK ((router_thread_id IS NULL AND command_id IS NULL AND message_id IS NULL AND body IS NULL)
        OR (router_thread_id IS NOT NULL AND command_id IS NOT NULL AND message_id IS NOT NULL AND body IS NOT NULL))
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS project_router_notices_pending
    ON project_router_notices(accepted, last_attempt, event_sequence)`;
});
