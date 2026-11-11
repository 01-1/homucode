import type { OrchestrationV2StoredEvent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Runs inside EventSink's projection transaction so a committed outcome cannot lose its delivery.
export const capture = Effect.fn("CompletionOutbox.capture")(function* (
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
) {
  const sql = yield* SqlClient.SqlClient;
  for (const { event } of events) {
    if (event.type !== "run.updated") continue;
    const run = event.payload;
    if (!["completed", "failed", "interrupted", "cancelled"].includes(run.status)) continue;
    yield* sql`
      INSERT OR IGNORE INTO thread_completion_outbox
        (thread_id, run_id, workspace_root, payload_json)
      SELECT t.thread_id, ${run.id}, p.workspace_root,
        json_object('schema', 1, 'thread_id', t.thread_id, 'run_id', ${run.id},
          'project_id', t.project_id, 'title', t.title, 'status', ${run.status},
          'created_at', ${DateTime.formatIso(run.completedAt ?? event.occurredAt)},
          'text', COALESCE((SELECT json_extract(m.payload_json, '$.text')
            FROM orchestration_v2_projection_messages m
            WHERE m.thread_id = t.thread_id AND m.run_id = ${run.id} AND m.role = 'assistant'
            ORDER BY COALESCE((SELECT MIN(i.ordinal) FROM orchestration_v2_projection_turn_items i
              WHERE i.thread_id = m.thread_id AND i.type = 'assistant_message'
                AND json_extract(i.payload_json, '$.messageId') = m.message_id), 9223372036854775807) DESC,
              m.created_at DESC, m.message_id DESC LIMIT 1), ''))
      FROM orchestration_v2_projection_threads t
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = ${run.threadId}
    `;
  }
});
