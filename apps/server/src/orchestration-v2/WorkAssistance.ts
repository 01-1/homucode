import {
  CommandId,
  IsoDateTime,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type ThreadActivityItem,
  type ThreadAssistResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const MAIN_PROJECT = ProjectId.make("00000000-0000-4000-8000-0000000000a1");
export const MAIN_ENVIRONMENT = "00000000-0000-4000-8000-0000000000e1";
const EXCLUDED = new Set([
  "mcp:launch:0000000000000000000000000000000000000000000000000000000000000001",
  "mcp:launch:0000000000000000000000000000000000000000000000000000000000000002",
  "mcp:00000000-0000-4000-8000-0000000000c1",
]);

export const assistanceCommandId = (threadId: ThreadId, runId: RunId) =>
  CommandId.make(`command:pace-v1:${encodeURIComponent(threadId)}:${encodeURIComponent(runId)}`);

interface State {
  thread_id: string;
  parent_id: string | null;
  relationship: "fork" | "subagent" | null;
  run_id: string | null;
  status: string | null;
  provider: string;
  archived: number;
  settled: number;
  helper: number;
  pending: number;
  waiting: number;
  stopping: number;
  quota: number;
  linked: number;
  provider_working: number;
  continuous_working_since: string | null;
}

export function activityItem(row: State, now: DateTime.Utc): ThreadActivityItem {
  const invalid: ThreadActivityItem["reason"] = row.archived
    ? "archived"
    : row.settled
      ? "settled"
      : EXCLUDED.has(row.thread_id) || row.linked
        ? "excluded"
        : row.helper
          ? "automation_helper"
          : row.stopping
            ? "stopping"
            : row.quota
              ? "quota"
              : row.pending
                ? "pending_request"
                : row.waiting
                  ? "thread_wait"
                  : row.status !== "running" || !row.provider_working
                    ? "not_running"
                    : null;
  const since = invalid === null ? row.continuous_working_since : null;
  const age =
    since === null
      ? null
      : DateTime.toEpochMillis(now) - DateTime.toEpochMillis(DateTime.makeUnsafe(since));
  const reason =
    invalid ??
    (age === null || age < 0 ? "unknown_continuity" : age <= 300_000 ? "under_threshold" : null);
  return {
    threadId: ThreadId.make(row.thread_id),
    parentThreadId: row.parent_id === null ? null : ThreadId.make(row.parent_id),
    relationshipToParent: row.relationship,
    activeRunId: row.run_id === null ? null : RunId.make(row.run_id),
    status: row.status ?? "idle",
    providerInstanceId: ProviderInstanceId.make(row.provider),
    continuousWorkingSince: since === null ? null : IsoDateTime.make(since),
    eligible: reason === null,
    reason,
    automationHelper: row.helper === 1,
    settled: row.settled === 1,
    archived: row.archived === 1,
    blockedOnThreadWait: row.waiting === 1,
    pendingRequestCount: row.pending,
  };
}

export const readActivity = Effect.fn("WorkAssistance.readActivity")(function* (
  threadId?: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const now = yield* DateTime.now;
  const rows = yield* sql<State>`
    SELECT t.thread_id, json_extract(t.payload_json, '$.lineage.parentThreadId') AS parent_id,
      json_extract(t.payload_json, '$.lineage.relationshipToParent') AS relationship,
      r.run_id, r.status, COALESCE(r.provider, t.default_provider) AS provider,
      t.archived_at IS NOT NULL AS archived,
      json_extract(t.payload_json, '$.settledOverride') = 'settled' AS settled,
      json_extract(t.payload_json, '$.automationOrigin') IS NOT NULL AS helper,
      (json_type(t.payload_json, '$.linkOrigin') = 'object' OR json_type(t.payload_json, '$.remoteChild') = 'object') AS linked,
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests q
        WHERE q.thread_id = t.thread_id AND q.status = 'pending') AS pending,
      (EXISTS(SELECT 1 FROM orchestration_v2_projection_turn_items i WHERE i.thread_id = t.thread_id
        AND i.run_id = r.run_id AND (i.status = 'waiting' OR
          (i.type = 'dynamic_tool' AND i.status = 'running' AND (
            lower(json_extract(i.payload_json, '$.toolName')) LIKE '%wait%'
            OR (json_extract(i.payload_json, '$.toolName') LIKE '%delegate_task'
              AND json_extract(i.payload_json, '$.input.mode') = 'wait'))))) OR EXISTS(SELECT 1 FROM orchestration_v2_projection_nodes n WHERE n.thread_id = t.thread_id
        AND n.run_id = r.run_id AND n.status = 'waiting')) AS waiting,
      EXISTS(SELECT 1 FROM orchestration_v2_projection_turn_items i WHERE i.thread_id = t.thread_id
        AND i.run_id = r.run_id AND i.type = 'run_interrupt_request') AS stopping,
      (json_extract(t.payload_json, '$.limitRecovery.runId') = r.run_id OR
        EXISTS(SELECT 1 FROM orchestration_v2_projection_turn_items i WHERE i.thread_id = t.thread_id
          AND i.run_id = r.run_id AND i.type = 'error'
          AND json_extract(i.payload_json, '$.failure.class') = 'usage_limit')) AS quota,
      EXISTS(SELECT 1 FROM orchestration_v2_projection_provider_turns p
        JOIN orchestration_v2_projection_nodes n ON n.node_id = p.node_id
        JOIN orchestration_v2_projection_provider_threads pt ON pt.provider_thread_id = p.provider_thread_id
        WHERE p.thread_id = t.thread_id AND n.run_id = r.run_id AND n.node_id = json_extract(r.payload_json, '$.rootNodeId')
          AND n.status = 'running' AND p.status = 'running' AND pt.status = 'active'
          AND p.run_attempt_id = json_extract(r.payload_json, '$.activeAttemptId')
          AND p.ordinal = (SELECT MAX(p2.ordinal) FROM orchestration_v2_projection_provider_turns p2
            WHERE p2.provider_thread_id = p.provider_thread_id AND p2.run_attempt_id = p.run_attempt_id)
          AND EXISTS(SELECT 1 FROM orchestration_v2_projection_provider_sessions ps
            WHERE ps.provider_session_id = pt.provider_session_id AND ps.status IN ('ready', 'running'))) AS provider_working,
      CASE WHEN c.run_id = r.run_id THEN c.continuous_working_since ELSE NULL END AS continuous_working_since
    FROM orchestration_v2_projection_threads t
    LEFT JOIN orchestration_v2_projection_runs r ON r.run_id = (
      SELECT r2.run_id FROM orchestration_v2_projection_runs r2 WHERE r2.thread_id = t.thread_id
      AND r2.status IN ('preparing', 'starting', 'running', 'waiting') ORDER BY r2.ordinal DESC LIMIT 1)
    LEFT JOIN work_assistance_continuity c ON c.thread_id = t.thread_id
    WHERE t.project_id = ${MAIN_PROJECT} AND t.deleted_at IS NULL
      AND (${threadId ?? null} IS NULL OR t.thread_id = ${threadId ?? null})
    ORDER BY t.thread_id
  `;
  return { now, threads: rows.map((row) => activityItem(row, now)) };
});

export const observe = Effect.fn("WorkAssistance.observe")(function* (
  event: OrchestrationV2DomainEvent,
) {
  if (
    event.type === "turn-item.updated" &&
    ![
      "dynamic_tool",
      "secret_request",
      "link_request",
      "error",
      "run_interrupt_request",
      "run_interrupt_result",
      "subagent",
    ].includes(event.payload.type)
  )
    return;
  if (
    !event.type.startsWith("thread.") &&
    !event.type.startsWith("provider-session.") &&
    ![
      "run.created",
      "run.updated",
      "node.updated",
      "provider-turn.updated",
      "provider-thread.updated",
      "runtime-request.updated",
      "turn-item.updated",
    ].includes(event.type)
  )
    return;
  const sql = yield* SqlClient.SqlClient;
  const { now, threads } = yield* readActivity(event.threadId);
  const item = threads[0];
  if (item === undefined) return;
  const working =
    item.reason === null ||
    item.reason === "unknown_continuity" ||
    item.reason === "under_threshold";
  yield* sql`INSERT INTO work_assistance_continuity(thread_id, run_id, continuous_working_since)
    VALUES (${item.threadId}, ${item.activeRunId}, ${working ? DateTime.formatIso(now) : null})
    ON CONFLICT(thread_id) DO UPDATE SET run_id = excluded.run_id,
      continuous_working_since = CASE WHEN excluded.continuous_working_since IS NOT NULL
        AND work_assistance_continuity.run_id = excluded.run_id
        THEN COALESCE(work_assistance_continuity.continuous_working_since, excluded.continuous_working_since)
        ELSE excluded.continuous_working_since END`;
});

export const HELPER_BRIEF = `Help the exact parent task make progress faster and unblock it. Read only the parent task context you need. Give a concrete diagnosis or a small, explicitly handed-off improvement. The target retains ownership of mutable files unless it explicitly gives you a narrow handoff. Do not create helpers, delegates or other agents. Honor the host's next/children wait and completion protocol; do not poll task_status. No authority to uncap, stop, restart, load, spend, access credentials, or change any target's provider/model/options. Remain inside MAIN and this task; do not access entrant/cloud projects. Return your result through normal native child completion to this exact parent task.`;

export const resetContinuity = Effect.fn("WorkAssistance.resetContinuity")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE work_assistance_continuity SET continuous_working_since = NULL`;
});

export const readAssistanceReceipt = Effect.fn("WorkAssistance.readAssistanceReceipt")(function* (
  threadId: ThreadId,
  runId: RunId,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ task_id: string; child_thread_id: string; child_run_id: string }>`
    SELECT task_id, child_thread_id, child_run_id FROM work_assistance_launches
    WHERE target_thread_id = ${threadId} AND target_run_id = ${runId} AND origin = 'pace-v1'`;
  const row = rows[0];
  return row === undefined
    ? null
    : ({
        taskId: NodeId.make(row.task_id),
        childThreadId: ThreadId.make(row.child_thread_id),
        childRunId: RunId.make(row.child_run_id),
        replayed: true,
      } satisfies ThreadAssistResult);
});
