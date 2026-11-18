import { expect, it } from "vite-plus/test";

import { compactionBlocksSteering, resolveComposerDispatchMode } from "./composerDispatch.ts";

it("blocks steering for explicit compaction, and for automatic compaction unless the provider takes steers then", () => {
  const during = (
    text: string | undefined,
    attachments: ReadonlyArray<unknown> = [],
    steersDuringCompaction = true,
  ) =>
    compactionBlocksSteering({
      compactCommandIsActive: false,
      compactionRunning: true,
      steersDuringCompaction,
      run: { userMessageId: "user" },
      messages: [
        ...(text === undefined ? [] : [{ id: "user", text, attachments }]),
        { id: "later", text: "/compact" },
      ],
    });

  for (const text of ["/compact", "  /COMPACT  ", "/compact keep the debugging notes"]) {
    expect(during(text)).toBe(true);
  }
  for (const text of ["Read the code", "/compactify", "please /compact", undefined]) {
    expect(during(text)).toBe(false);
  }
  expect(during("/compact", [{}])).toBe(false);
  expect(during("Read the code", [], false)).toBe(true);

  expect(
    compactionBlocksSteering({
      compactCommandIsActive: true,
      compactionRunning: false,
      steersDuringCompaction: true,
      run: undefined,
      messages: undefined,
    }),
  ).toBe(true);
  expect(
    compactionBlocksSteering({
      compactCommandIsActive: false,
      compactionRunning: false,
      steersDuringCompaction: false,
      run: { userMessageId: "user" },
      messages: [{ id: "user", text: "/compact" }],
    }),
  ).toBe(false);
});

it("keeps a steer as a steer while compaction blocks steering, and queues a restart", () => {
  const blocked = (activeTurnDefault: "steer" | "queue" | "restart", alternateModifier = false) =>
    resolveComposerDispatchMode({
      running: true,
      alternateModifier,
      activeTurnDefault,
      canSteer: false,
    });
  expect(blocked("steer")).toBe("steer");
  expect(blocked("steer", true)).toBe("queue");
  expect(blocked("queue")).toBe("queue");
  expect(blocked("queue", true)).toBe("steer");
  expect(blocked("restart")).toBe("queue");
});
