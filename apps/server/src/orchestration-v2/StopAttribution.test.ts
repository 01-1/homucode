import { GuestMessageId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { messageStopActor } from "./StopAttribution.ts";

const context = (surface: "web" | "desktop" | "mobile" | "cli") => ({
  version: 1 as const,
  records: [],
  sentFrom: { surface },
});

describe("messageStopActor", () => {
  it.each([
    {
      sender: "the desktop app",
      message: { createdBy: "user", context: context("desktop") },
      actor: "human",
    },
    {
      sender: "the phone app",
      message: { createdBy: "user", context: context("mobile") },
      actor: "human",
    },
    {
      sender: "a guest",
      message: {
        createdBy: "user",
        context: {
          version: 1 as const,
          records: [],
          guest: { guestMessageId: GuestMessageId.make("guest"), name: "Sam", text: "stop" },
        },
      },
      actor: "human",
    },
    {
      sender: "the t3 CLI",
      message: { createdBy: "user", context: context("cli") },
      actor: "unknown",
    },
    { sender: "a client that named no surface", message: { createdBy: "user" }, actor: "unknown" },
    {
      sender: "an agent's thread",
      message: { createdBy: "agent", senderThreadId: ThreadId.make("thread:sender") },
      actor: "agent",
    },
    {
      sender: "an agent tool call with no thread",
      message: { createdBy: "agent" },
      actor: "unknown",
    },
    {
      sender: "a scheduled task",
      message: {
        createdBy: "user",
        scheduledTaskId: ScheduledTaskId.make("task"),
        context: context("web"),
      },
      actor: "unknown",
    },
  ] as const)("names $sender as $actor", ({ message, actor }) => {
    expect(messageStopActor(message)).toBe(actor);
  });
});
