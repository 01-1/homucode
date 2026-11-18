import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CheckpointDiffQuery from "../../../checkpointing/CheckpointDiffQuery.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as AppHandlers from "./handlers.ts";
import { AppToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:app");
const threadId = ThreadId.make("thread:app");

it.effect("a thread diff defaults to the newest ready turn and pages a long diff", () => {
  const requests: Array<unknown> = [];
  const diff = "x".repeat(AppHandlers.DIFF_PAGE_CHARS + 10);
  const checkpoint = (appRunOrdinal: number, status: string) => ({ appRunOrdinal, status });
  return Effect.gen(function* () {
    const toolkit = yield* AppToolkit;
    const read = (params: Record<string, unknown>) =>
      toolkit.handle("t3_thread_diff", params as never).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((chunks) => chunks.at(-1)?.result),
      );
    expect(yield* read({})).toMatchObject({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 3,
      diff: diff.slice(0, AppHandlers.DIFF_PAGE_CHARS),
      nextOffset: AppHandlers.DIFF_PAGE_CHARS,
    });
    expect(yield* read({ offset: AppHandlers.DIFF_PAGE_CHARS })).toMatchObject({
      diff: "x".repeat(10),
      nextOffset: null,
    });
    expect(requests).toEqual([
      { threadId, toTurnCount: 3 },
      { threadId, toTurnCount: 3 },
    ]);
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(AppHandlers.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(McpInvocationContext.McpInvocationContext, {
              environmentId,
              requestNamespace: "provider:app",
              thread: {
                threadId,
                providerSessionId: "provider:app",
                providerInstanceId: ProviderInstanceId.make("codex"),
              },
              client: undefined,
              capabilities: new Set(["orchestration" as const]),
              issuedAt: 0,
            }),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
              getProjectThreadRecords: () =>
                Effect.succeed({
                  ...idleThreadProjection(liveThreadShell(threadId)),
                  checkpoints: [
                    checkpoint(1, "ready"),
                    checkpoint(3, "ready"),
                    checkpoint(5, "capturing"),
                  ],
                } as never),
            }),
            Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
              getFullThreadDiff: (input) => {
                requests.push(input);
                return Effect.succeed({ ...input, fromTurnCount: 0, diff });
              },
            }),
          ),
        ),
      ),
    ),
  );
});
