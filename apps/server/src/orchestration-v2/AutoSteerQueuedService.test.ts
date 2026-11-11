import { describe, expect, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { runAutoSteerPass, type AutoSteerPromotion } from "./AutoSteerQueuedService.ts";

const threadId = ThreadId.make("thread:auto-steer-test");
const promotion = (id: string): AutoSteerPromotion => ({
  queuedRunId: RunId.make(id),
  targetRunId: RunId.make("run:active"),
  skipsCompaction: false,
});

/** Heads seen on successive reads; null means nothing eligible. */
const harness = (heads: ReadonlyArray<AutoSteerPromotion | null>, refuse: ReadonlySet<string>) => {
  const dirty = new Set<ThreadId>();
  const dispatched: Array<string> = [];
  let reads = 0;
  return {
    dirty,
    dispatched,
    deps: {
      dirty,
      compactionsSkipped: new Set<string>(),
      read: () => Effect.sync(() => heads[Math.min(reads++, heads.length - 1)] ?? null),
      select: (head: AutoSteerPromotion | null) => head,
      dispatch: (_thread: ThreadId, next: AutoSteerPromotion) =>
        Effect.suspend(() => {
          dispatched.push(next.queuedRunId);
          if (!refuse.has(next.queuedRunId)) return Effect.void;
          // The reorder that made A stale also emitted a trigger while this dispatch ran.
          dirty.add(threadId);
          return Effect.fail("refused: no longer the queue head");
        }),
    },
  };
};

describe("runAutoSteerPass", () => {
  it.effect("rereads after a refused stale head when a trigger arrived, and steers the new head", () =>
    Effect.gen(function* () {
      const h = harness([promotion("run:A"), promotion("run:B"), null], new Set(["run:A"]));
      yield* runAutoSteerPass(h.deps, threadId);
      expect(h.dispatched).toEqual(["run:A", "run:B"]);
      expect(h.dirty.has(threadId)).toBe(false);
    }),
  );

  it.effect("stops after a refusal when no new trigger arrived", () =>
    Effect.gen(function* () {
      const h = harness([promotion("run:A"), promotion("run:A")], new Set());
      const refusing = {
        ...h.deps,
        dispatch: (_thread: ThreadId, next: AutoSteerPromotion) =>
          Effect.suspend(() => {
            h.dispatched.push(next.queuedRunId);
            return Effect.fail("refused");
          }),
      };
      yield* runAutoSteerPass(refusing, threadId);
      expect(h.dispatched).toEqual(["run:A"]);
    }),
  );

  it.effect("drains successive heads and ends when nothing is eligible", () =>
    Effect.gen(function* () {
      const h = harness([promotion("run:A"), promotion("run:B"), null], new Set());
      yield* runAutoSteerPass(h.deps, threadId);
      expect(h.dispatched).toEqual(["run:A", "run:B"]);
    }),
  );
});
