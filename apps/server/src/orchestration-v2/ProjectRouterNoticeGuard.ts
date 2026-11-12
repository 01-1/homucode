import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** Host-only, fiber-local guard. Not a command field, provider tool or callback registry. */
export class Target extends Context.Reference<{
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
} | undefined>("t3/ProjectRouterNoticeGuard", { defaultValue: () => undefined }) {}

export class TargetChanged extends Schema.TaggedError<TargetChanged>()("ProjectRouterNoticeTargetChanged", {}) {}

/** Called only inside the existing command SQL transaction, after receipt replay. */
export const validate = Effect.fn("ProjectRouterNoticeGuard.validate")(function* (input: {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly commandType: string;
}) {
  const target = yield* Target;
  if (target === undefined || target.commandId !== input.commandId) return;
  if (input.commandType !== "message.dispatch" || target.threadId !== input.threadId) {
    return yield* new TargetChanged({});
  }
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 FROM orchestration_v2_projection_threads
    WHERE thread_id = ${target.threadId}
      AND json_extract(payload_json, '$.projectId') = ${target.projectId}
      AND json_extract(payload_json, '$.deletedAt') IS NULL
      AND json_extract(payload_json, '$.archivedAt') IS NULL`;
  if (rows.length !== 1) return yield* new TargetChanged({});
});
