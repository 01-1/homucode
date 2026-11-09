import {
  OrchestrationMessageSentFrom,
  type MessageId,
  type OrchestrationMessageContext,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeSentFrom = Schema.decodeUnknownOption(OrchestrationMessageSentFrom);

/**
 * The client a socket's user messages come from, read from what the socket declared when it
 * connected (`readClientAnalyticsProps` in ws.ts). Undefined when it named no known surface.
 */
export function sentFromConnection(
  props: Readonly<Record<string, unknown>>,
): OrchestrationMessageSentFrom | undefined {
  const candidate = {
    surface: props.surface,
    os: props.clientOs,
    deviceType: props.clientDeviceType,
    deviceModel: props.deviceModel,
    browser: props.clientBrowser,
    connectionMethod: props.connectionMethod,
  };
  // Drop each field that does not decode on its own, so one odd value keeps the rest.
  const fields = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        value !== undefined &&
        (key === "surface" || decodeSentFrom({ surface: "web", [key]: value })._tag === "Some"),
    ),
  );
  const decoded = decodeSentFrom(fields);
  return decoded._tag === "Some" ? decoded.value : undefined;
}

/**
 * One entry of the server's device-names file (`<stateDir>/device-names.json`, shaped
 * `{ "devices": [{ "name": "my-phone", "surface": "mobile", "deviceModel": "Pixel 9" }] }`).
 * Every field given must equal the connection's; the first matching entry names the device.
 */
export interface DeviceNameRule {
  readonly name: string;
  readonly surface?: string;
  readonly os?: string;
  readonly deviceType?: string;
  readonly deviceModel?: string;
  readonly browser?: string;
  readonly connectionMethod?: string;
}

const MATCH_FIELDS = [
  "surface",
  "os",
  "deviceType",
  "deviceModel",
  "browser",
  "connectionMethod",
] as const;

/** The rules in a device-names file's text; anything malformed is skipped, never fatal. */
export function parseDeviceNameRules(text: string): ReadonlyArray<DeviceNameRule> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const devices =
    typeof parsed === "object" && parsed !== null && "devices" in parsed
      ? (parsed as { readonly devices: unknown }).devices
      : undefined;
  if (!Array.isArray(devices)) return [];
  return devices.flatMap((entry): ReadonlyArray<DeviceNameRule> => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name === "" || name.length > 40) return [];
    const match = Object.fromEntries(
      MATCH_FIELDS.flatMap((field) =>
        typeof record[field] === "string" ? [[field, record[field]]] : [],
      ),
    );
    // A rule that matches every device would name all of them; require at least one field.
    return Object.keys(match).length === 0 ? [] : [{ name, ...match }];
  });
}

/** The connection's device with the name its first matching rule gives, if any. */
export function withDeviceName(
  sentFrom: OrchestrationMessageSentFrom | undefined,
  rules: ReadonlyArray<DeviceNameRule>,
): OrchestrationMessageSentFrom | undefined {
  if (sentFrom === undefined) return undefined;
  const { deviceName: _claimed, ...device } = sentFrom;
  const rule = rules.find((candidate) =>
    MATCH_FIELDS.every(
      (field) => candidate[field] === undefined || candidate[field] === device[field],
    ),
  );
  return rule === undefined ? device : { ...device, deviceName: rule.name };
}

/** A message context stamped with the socket's device, replacing any the client claimed. */
function withContextSentFrom(
  context: OrchestrationMessageContext | undefined,
  sentFrom: OrchestrationMessageSentFrom | undefined,
): OrchestrationMessageContext | undefined {
  const { sentFrom: _claimed, ...rest } = context ?? { version: 1 as const, records: [] };
  if (sentFrom !== undefined) return { ...rest, sentFrom };
  return context === undefined ? undefined : rest;
}

/** Stamps a client's message with its socket's device, replacing any the client claimed. */
export function withConnectionSentFrom(
  command: OrchestrationV2Command,
  sentFrom: OrchestrationMessageSentFrom | undefined,
): OrchestrationV2Command {
  if (command.type !== "message.dispatch") return command;
  const context = withContextSentFrom(command.context, sentFrom);
  const { context: _context, ...rest } = command;
  return context === undefined ? rest : { ...rest, context };
}

/** Only a user's own message carries a device; anything else that claims one loses it. */
export function withoutNonUserSentFrom<
  C extends {
    readonly createdBy: string;
    readonly context?: OrchestrationMessageContext | undefined;
  },
>(command: C): C {
  if (command.createdBy === "user" || command.context?.sentFrom === undefined) return command;
  const { sentFrom: _sentFrom, ...context } = command.context;
  return { ...command, context };
}

const SURFACE_LABELS: Record<OrchestrationMessageSentFrom["surface"], string> = {
  web: "T3 web",
  desktop: "T3 desktop",
  mobile: "T3 mobile",
  cli: "T3 CLI",
};

/**
 * The line the agent reads with a user's message, such as
 * `[T3] Sent from: T3 mobile (iOS, iPhone 16 Pro, via relay)`. Empty for messages an agent,
 * a scheduled task, or T3 itself sent, and for messages from clients that named no surface.
 */
type SentMessage = Pick<
  OrchestrationV2ConversationMessage,
  "createdBy" | "context" | "scheduledTaskId" | "senderThreadId"
>;

export function sentFromLine(message: SentMessage): string {
  const sentFrom = message.context?.sentFrom;
  if (
    message.createdBy !== "user" ||
    message.scheduledTaskId !== undefined ||
    message.senderThreadId !== undefined ||
    sentFrom === undefined
  ) {
    return "";
  }
  const details = [
    sentFrom.os === undefined || sentFrom.os === "unknown" || sentFrom.os === "other"
      ? undefined
      : sentFrom.os,
    sentFrom.deviceModel ?? (sentFrom.deviceType === "phone" ? "phone" : undefined),
    sentFrom.deviceType === "tablet" && sentFrom.deviceModel === undefined ? "tablet" : undefined,
    sentFrom.surface === "web" ? sentFrom.browser : undefined,
    sentFrom.connectionMethod === "relay" || sentFrom.connectionMethod === "ssh"
      ? `via ${sentFrom.connectionMethod}`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  const label = SURFACE_LABELS[sentFrom.surface];
  if (sentFrom.deviceName !== undefined) {
    return `[T3] Sent from: ${sentFrom.deviceName} (${[label, ...details].join(", ")})`;
  }
  return `[T3] Sent from: ${details.length === 0 ? label : `${label} (${details.join(", ")})`}`;
}

/**
 * The prompt with its device line after it. Slash commands go verbatim, since providers parse
 * them from the start and end of the prompt.
 */
export function withSentFromLine(text: string, message: SentMessage): string {
  const line = sentFromLine(message);
  if (line === "" || text.trimStart().startsWith("/")) return text;
  return text === "" ? line : `${text}\n\n${line}`;
}

/** An edited message keeps the device it was first sent from; an edit cannot claim one. */
export function withOriginalSentFrom(
  context: OrchestrationMessageContext,
  original: OrchestrationMessageContext | undefined,
): OrchestrationMessageContext {
  const { sentFrom: _claimed, ...rest } = context;
  return original?.sentFrom === undefined ? rest : { ...rest, sentFrom: original.sentFrom };
}

/** A launch's first message, stamped with the socket's device like `withConnectionSentFrom`. */
export function launchInitialMessage<Attachments>(
  message: {
    readonly messageId?: MessageId | undefined;
    readonly text: string;
    readonly attachments: Attachments;
    readonly context?: OrchestrationMessageContext | undefined;
  },
  sentFrom: OrchestrationMessageSentFrom | undefined,
): {
  readonly messageId?: MessageId;
  readonly text: string;
  readonly attachments: Attachments;
  readonly context?: OrchestrationMessageContext;
} {
  const context = withContextSentFrom(message.context, sentFrom);
  return {
    ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
    text: message.text,
    attachments: message.attachments,
    ...(context === undefined ? {} : { context }),
  };
}
