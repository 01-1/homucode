import type { ProviderReplayTranscript } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** The line T3 appends to a human's message that names no device. */
export const UNKNOWN_DEVICE_HUMAN_LINE =
  "[T3] Sent from: unknown device. A human sent this message.";

/** `line`, when given, is the source line T3 appends after the text (see `messageSourceLine`). */
export function timestampedPrompt(text: string, sentAt: DateTime.Utc, line?: string): string {
  const local = DateTime.formatIso(
    DateTime.add(sentAt, { minutes: -DateTime.toDateUtc(sentAt).getTimezoneOffset() }),
  ).slice(0, 19);
  return line === undefined ? `${local}: ${text}` : `${local}: ${text}\n\n${line}`;
}

export function materializeReplayPromptTimestamps(
  transcript: ProviderReplayTranscript,
  prompts: ReadonlyArray<string>,
  sentAt: DateTime.Utc,
  line?: string,
): ProviderReplayTranscript {
  const replacements = new Map(
    prompts.map((text) => [text, timestampedPrompt(text, sentAt, line)]),
  );
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      const exact = replacements.get(value);
      if (exact !== undefined) return exact;
      if (line === undefined) return value;
      // ACP agents get a prompt's first message wrapped in `<user_request>`, with the sender line inside.
      return prompts.reduce(
        (wrapped, text) =>
          wrapped.replace(
            `<user_request>\n${text}\n</user_request>`,
            () => `<user_request>\n${text}\n\n${line}\n</user_request>`,
          ),
        value,
      );
    }
    if (Array.isArray(value)) return value.map(replace);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
  };
  return {
    ...transcript,
    entries: transcript.entries.map((entry) =>
      entry.type === "expect_outbound" ? { ...entry, frame: replace(entry.frame) } : entry,
    ),
  };
}
