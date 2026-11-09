import { CommandId, MessageId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  sentFromConnection,
  sentFromLine,
  withConnectionSentFrom,
  withoutNonUserSentFrom,
  withSentFromLine,
} from "./MessageSentFrom.ts";

const userMessage = (props: Readonly<Record<string, unknown>>) => {
  const sentFrom = sentFromConnection(props);
  return {
    createdBy: "user" as const,
    context: { version: 1 as const, records: [], ...(sentFrom ? { sentFrom } : {}) },
  };
};

describe("sentFromConnection and sentFromLine", () => {
  it.each([
    {
      client: "mobile over relay",
      props: {
        surface: "mobile",
        clientOs: "iOS",
        clientDeviceType: "phone",
        deviceModel: "iPhone 16 Pro",
        connectionMethod: "relay",
      },
      line: "[T3] Sent from: T3 mobile (iOS, iPhone 16 Pro, via relay)",
    },
    {
      client: "mobile without a model",
      props: { surface: "mobile", clientOs: "Android", clientDeviceType: "phone" },
      line: "[T3] Sent from: T3 mobile (Android, phone)",
    },
    {
      client: "desktop",
      props: { surface: "desktop", clientOs: "Linux", connectionMethod: "direct" },
      line: "[T3] Sent from: T3 desktop (Linux)",
    },
    {
      client: "web",
      props: { surface: "web", clientOs: "macOS", clientBrowser: "Safari" },
      line: "[T3] Sent from: T3 web (macOS, Safari)",
    },
    {
      // A field the schema refuses is dropped; the rest stays.
      client: "desktop with an odd os",
      props: { surface: "desktop", clientOs: "BeOS", deviceModel: "x".repeat(200) },
      line: "[T3] Sent from: T3 desktop",
    },
  ])("records and renders $client", ({ props, line }) => {
    expect(sentFromLine(userMessage(props))).toBe(line);
  });

  it("degrades to nothing for a client that named no surface", () => {
    expect(sentFromConnection({})).toBeUndefined();
    expect(sentFromConnection({ surface: "toaster", clientOs: "Linux" })).toBeUndefined();
    expect(sentFromLine(userMessage({}))).toBe("");
    expect(withSentFromLine("Hello", userMessage({}))).toBe("Hello");
  });

  it("adds nothing for agents, scheduled tasks, or slash commands", () => {
    const fromPhone = userMessage({ surface: "mobile", clientOs: "iOS" });
    expect(withSentFromLine("Hello", fromPhone)).toBe("Hello\n\n[T3] Sent from: T3 mobile (iOS)");
    expect(sentFromLine({ ...fromPhone, createdBy: "agent" })).toBe("");
    expect(sentFromLine({ ...fromPhone, senderThreadId: ThreadId.make("parent") })).toBe("");
    expect(sentFromLine({ ...fromPhone, scheduledTaskId: ScheduledTaskId.make("task") })).toBe("");
    expect(withSentFromLine("/goal ship it", fromPhone)).toBe("/goal ship it");
  });
});

describe("withConnectionSentFrom", () => {
  const command = {
    type: "message.dispatch" as const,
    commandId: CommandId.make("command"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    text: "Hi",
    attachments: [],
    createdBy: "user" as const,
    creationSource: "web" as const,
    dispatchMode: { type: "queue_after_active" as const },
  };
  const claimed = {
    ...command,
    context: {
      version: 1 as const,
      records: [],
      sentFrom: { surface: "desktop" as const, os: "Windows" as const },
    },
  };

  it("replaces what a client claims with its socket's device, or removes it", () => {
    const phone = sentFromConnection({ surface: "mobile", clientOs: "iOS" });
    expect(withConnectionSentFrom(claimed, phone)).toMatchObject({
      context: { sentFrom: { surface: "mobile", os: "iOS" } },
    });
    expect(withConnectionSentFrom(command, phone)).toMatchObject({
      context: { version: 1, records: [], sentFrom: { surface: "mobile" } },
    });
    const unknown = withConnectionSentFrom(claimed, undefined);
    expect(unknown.type === "message.dispatch" && unknown.context?.sentFrom).toBeUndefined();
    expect(withConnectionSentFrom(command, undefined)).toEqual(command);
  });

  it("drops a device from a message a user did not send", () => {
    expect(withoutNonUserSentFrom({ ...claimed, createdBy: "agent" }).context.sentFrom).toBe(
      undefined,
    );
    expect(withoutNonUserSentFrom(claimed).context.sentFrom).toEqual(claimed.context.sentFrom);
  });
});
