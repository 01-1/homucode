import type { ProviderReplayTranscript } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function timestampedPrompt(text: string, sentAt: DateTime.Utc): string {
  const local = DateTime.formatIso(
    DateTime.add(sentAt, { minutes: -DateTime.toDateUtc(sentAt).getTimezoneOffset() }),
  ).slice(0, 19);
  return `${local}: ${text}`;
}

export function materializeReplayPromptTimestamps(
  transcript: ProviderReplayTranscript,
  prompts: ReadonlyArray<string>,
  sentAt: DateTime.Utc,
): ProviderReplayTranscript {
  const replacements = new Map(prompts.map((text) => [text, timestampedPrompt(text, sentAt)]));
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return replacements.get(value) ?? value;
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
