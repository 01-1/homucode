import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationV2StoredEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export interface Notice {
  readonly event_id: string;
  readonly event_sequence: number;
  readonly project_id: string;
  readonly thread_id: string;
  readonly title: string;
  readonly creator: string;
  readonly created_at: string;
  readonly router_thread_id: string | null;
  readonly command_id: string | null;
  readonly message_id: string | null;
  readonly body: string | null;
  readonly accepted: number;
  readonly last_error: string | null;
  readonly last_attempt: number;
}

export interface BoundNotice extends Notice {
  readonly router_thread_id: string;
  readonly command_id: string;
  readonly message_id: string;
  readonly body: string;
}

export const isBound = (notice: Notice): notice is BoundNotice =>
  notice.router_thread_id !== null &&
  notice.command_id !== null &&
  notice.message_id !== null &&
  notice.body !== null;

export const identities = (eventId: string, routerId: string) => {
  const key = `project-router-notice:v1:${encodeURIComponent(eventId)}:${encodeURIComponent(routerId)}`;
  return { commandId: CommandId.make(key), messageId: MessageId.make(key) };
};

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const cursor = sql<{
    cursor: number | null;
  }>`SELECT cursor FROM project_router_notice_state WHERE id = 1`.pipe(
    Effect.map((rows) => rows[0]?.cursor ?? null),
  );
  // The read and first-enable write use the same existing SQLite transaction/connection.
  const enable = sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`UPDATE project_router_notice_state
      SET first_sequence = (SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events),
          cursor = (SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events)
      WHERE id = 1 AND first_sequence IS NULL`;
      return yield* cursor;
    }),
  );
  const configError = (error: string | null) =>
    sql`UPDATE project_router_notice_state
    SET config_error = ${error} WHERE id = 1 AND config_error IS NOT ${error}`.pipe(Effect.asVoid);
  const capture = (
    stored: OrchestrationV2StoredEvent,
    metadata: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly title: string;
      readonly creator: string;
      readonly createdAt: string;
    } | null,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const after = yield* cursor;
        if (after === null || stored.sequence <= after) return;
        if (metadata !== null) {
          yield* sql`INSERT OR IGNORE INTO project_router_notices
        (event_id, event_sequence, project_id, thread_id, title, creator, created_at)
        VALUES (${stored.event.id}, ${stored.sequence}, ${metadata.projectId}, ${metadata.threadId},
          ${metadata.title}, ${metadata.creator}, ${metadata.createdAt})`;
        }
        yield* sql`UPDATE project_router_notice_state SET cursor = ${stored.sequence} WHERE id = 1`;
      }),
    );
  const pending = sql<Notice>`SELECT * FROM project_router_notices WHERE accepted = 0
    ORDER BY last_attempt, event_sequence LIMIT 100`;
  const pin = Effect.fn("ProjectRouterNoticeStore.pin")(function* (
    notice: Notice,
    routerId: ThreadId,
    body: string,
  ) {
    const ids = identities(notice.event_id, routerId);
    yield* sql`UPDATE project_router_notices SET router_thread_id = ${routerId},
      command_id = ${ids.commandId}, message_id = ${ids.messageId}, body = ${body}
      WHERE event_id = ${notice.event_id} AND router_thread_id IS NULL`;
    const rows =
      yield* sql<Notice>`SELECT * FROM project_router_notices WHERE event_id = ${notice.event_id}`;
    return rows[0];
  });
  const record = (notice: Notice, now: number, error: string | null, accepted = false) =>
    sql`UPDATE project_router_notices SET last_attempt = ${now}, last_error = ${error},
      accepted = ${accepted ? 1 : 0} WHERE event_id = ${notice.event_id} AND accepted = 0`.pipe(
      Effect.asVoid,
    );
  return { cursor, enable, configError, capture, pending, pin, record };
});
