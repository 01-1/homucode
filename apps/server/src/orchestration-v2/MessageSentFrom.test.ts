import { CommandId, MessageId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  launchInitialMessage,
  parseDeviceNameRules,
  sentFromConnection,
  sentFromLine,
  withConnectionSentFrom,
  withDeviceName,
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

describe("launchInitialMessage", () => {
  const forged = {
    version: 1 as const,
    records: [],
    sentFrom: { surface: "desktop" as const, os: "Windows" as const },
  };

  it("stamps a new thread's first message with its socket's device, never the client's", () => {
    const phone = sentFromConnection({ surface: "mobile", clientOs: "iOS" });
    expect(
      launchInitialMessage({ text: "Start", attachments: [], context: forged }, phone).context
        ?.sentFrom,
    ).toEqual({ surface: "mobile", os: "iOS" });
    expect(launchInitialMessage({ text: "Start", attachments: [] }, phone).context).toEqual({
      version: 1,
      records: [],
      sentFrom: { surface: "mobile", os: "iOS" },
    });
    expect(
      launchInitialMessage({ text: "Start", attachments: [], context: forged }, undefined).context
        ?.sentFrom,
    ).toBeUndefined();
  });
});

describe("device names", () => {
  const rules = parseDeviceNameRules(
    JSON.stringify({
      devices: [
        { name: "my-phone", surface: "mobile", deviceModel: "Pixel 9" },
        { name: "work-laptop", surface: "desktop", os: "Linux" },
        { name: "studio-mac", os: "macOS" },
        { name: "everything" },
        { name: "", os: "Windows" },
        "junk",
      ],
    }),
  );

  it("keeps only rules with a name and at least one field to match", () => {
    expect(rules.map((rule) => rule.name)).toEqual(["my-phone", "work-laptop", "studio-mac"]);
    expect(parseDeviceNameRules("not json")).toEqual([]);
    expect(parseDeviceNameRules("{}")).toEqual([]);
  });

  it("names a device by its first matching rule and replaces a claimed name", () => {
    const phone = sentFromConnection({
      surface: "mobile",
      clientOs: "Android",
      clientDeviceType: "tablet",
      deviceModel: "Pixel 9",
      connectionMethod: "relay",
    });
    expect(withDeviceName(phone, rules)?.deviceName).toBe("my-phone");
    const laptop = sentFromConnection({ surface: "desktop", clientOs: "Linux" });
    expect(withDeviceName(laptop, rules)?.deviceName).toBe("work-laptop");
    const mac = sentFromConnection({ surface: "web", clientOs: "macOS", clientBrowser: "Safari" });
    expect(withDeviceName(mac, rules)?.deviceName).toBe("studio-mac");
    const other = { surface: "web" as const, os: "Windows" as const, deviceName: "forged" };
    expect(withDeviceName(other, rules)).toEqual({ surface: "web", os: "Windows" });
    expect(withDeviceName(undefined, rules)).toBeUndefined();
  });

  it("puts the name first in the agent's line", () => {
    const sentFrom = withDeviceName(
      sentFromConnection({
        surface: "mobile",
        clientOs: "Android",
        deviceModel: "Pixel 9",
        connectionMethod: "relay",
      }),
      rules,
    );
    expect(
      sentFromLine({ createdBy: "user", context: { version: 1, records: [], sentFrom } }),
    ).toBe("[T3] Sent from: my-phone (T3 mobile, Android, Pixel 9, via relay)");
  });
});
