import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";

export const Configuration = Schema.Struct({
  schema: Schema.Literal(1),
  enabled: Schema.Boolean,
  bindings: Schema.Array(Schema.Struct({ projectId: ProjectId, routerThreadId: ThreadId })),
});
export type Configuration = typeof Configuration.Type;
export const disabled: Configuration = { schema: 1, enabled: false, bindings: [] };

export class ConfigError extends Schema.TaggedError<ConfigError>()(
  "ProjectRouterNoticeConfigError",
  {
    reason: Schema.Literals(["read_failed", "invalid_configuration", "duplicate_project"]),
  },
) {}

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Configuration), {
  onExcessProperty: "error",
});

export const decodeConfig = (text: string) =>
  text.trim() === "" || text.trim() === "{}"
    ? Effect.succeed(disabled)
    : decode(text).pipe(
        Effect.mapError(() => new ConfigError({ reason: "invalid_configuration" })),
        Effect.filterOrElse(
          (config) =>
            new Set(config.bindings.map((binding) => binding.projectId)).size ===
            config.bindings.length,
          () => new ConfigError({ reason: "duplicate_project" }),
        ),
      );

/** Server-local sidecar; never reads project files or writes configuration. */
export const makeReader = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const file = path.join(stateDir, "project-router-notices.json");
  return fs.readFileString(file).pipe(
    Effect.catch((cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed("")
        : new ConfigError({ reason: "read_failed" }),
    ),
    Effect.flatMap(decodeConfig),
  );
});
