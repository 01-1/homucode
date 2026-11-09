import { CommandId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withClientStopScope } from "./ClientStopScope.ts";

const threadId = ThreadId.make("thread");
const commandId = CommandId.make("command");
const runId = RunId.make("run");

describe("withClientStopScope", () => {
  it("makes an app's Stop leave subagents running, as older phones send it", () => {
    expect(withClientStopScope({ type: "thread.stop", commandId, threadId })).toEqual({
      type: "thread.stop",
      commandId,
      threadId,
      leaveSubagentsRunning: true,
    });
    expect(
      withClientStopScope({ type: "run.interrupt", commandId, threadId, runId, holdQueue: true }),
    ).toEqual({
      type: "run.interrupt",
      commandId,
      threadId,
      runId,
      holdQueue: true,
      leaveSubagentsRunning: true,
    });
  });

  it("keeps an explicit choice and leaves plain interrupts alone", () => {
    const cascade = { type: "thread.stop", commandId, threadId, stopDelegatedTasks: true } as const;
    expect(withClientStopScope(cascade)).toBe(cascade);
    const walk = { type: "thread.stop", commandId, threadId, stopDelegatedTasks: false } as const;
    expect(withClientStopScope(walk)).toBe(walk);
    const interrupt = { type: "run.interrupt", commandId, threadId, runId } as const;
    expect(withClientStopScope(interrupt)).toBe(interrupt);
  });
});
