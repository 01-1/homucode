import { describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { CursorOrchestratorReplayHarness } from "../Adapters/CursorAdapterV2.testkit.ts";
import { timestampedPrompt, UNKNOWN_DEVICE_HUMAN_LINE } from "./ReplayMessageTimestamps.ts";
import {
  MESSAGE_STEERING_INITIAL_PROMPT,
  MESSAGE_STEERING_STEER_PROMPT,
  SKILL_INVOCATION_CURSOR_MESSAGE,
} from "./fixtures/shared.ts";
import { messageRestartInput } from "./fixtures/message_steering/input.ts";
import {
  findReplayFixture,
  itRunsReplayFixtures,
  runReplayFixture,
} from "./ProviderReplayFixtures.ts";

describe("Cursor replay fixtures", () => {
  itRunsReplayFixtures("cursor", (input) =>
    runReplayFixture({
      ...input,
      harness: CursorOrchestratorReplayHarness,
      transformTranscript: (transcript) =>
        // Only slash commands go verbatim; the `$review` prompt Cursor turns into this one keeps its sender line.
        input.fixtureName === "skill_invocation"
          ? {
              ...transcript,
              entries: transcript.entries.map((entry) => {
                if (entry.type !== "expect_outbound") return entry;
                const frame = entry.frame as { readonly message?: unknown };
                return frame.message === SKILL_INVOCATION_CURSOR_MESSAGE
                  ? {
                      ...entry,
                      frame: {
                        ...frame,
                        message: `${SKILL_INVOCATION_CURSOR_MESSAGE}\n\n${UNKNOWN_DEVICE_HUMAN_LINE}`,
                      },
                    }
                  : entry;
              }),
            }
          : (input.transformTranscript?.(transcript) ?? transcript),
    }),
  );

  const cursorSteeringProvider = findReplayFixture("message_steering")?.providers.find(
    (provider) => provider.driver === "cursor",
  );
  if (cursorSteeringProvider !== undefined) {
    it.effect("executes explicit Cursor restart_active through the recorded SDK boundary", () =>
      runReplayFixture({
        fixtureName: "message_steering",
        buildInput: messageRestartInput,
        driver: {
          ...cursorSteeringProvider,
          transcriptFile: new URL(
            "./fixtures/message_steering/cursor_restart_transcript.ndjson",
            import.meta.url,
          ),
        },
        harness: CursorOrchestratorReplayHarness,
        transformTranscript: (transcript) => ({
          ...transcript,
          entries: transcript.entries.map((entry) => {
            if (entry.type !== "expect_outbound" || entry.label !== "run.start:2") return entry;
            const frame = entry.frame as { readonly message: string };
            let message = frame.message;
            for (const prompt of [MESSAGE_STEERING_INITIAL_PROMPT, MESSAGE_STEERING_STEER_PROMPT]) {
              message = message.replace(
                prompt,
                timestampedPrompt(prompt, DateTime.makeUnsafe(0), UNKNOWN_DEVICE_HUMAN_LINE),
              );
            }
            return { ...entry, frame: { ...frame, message } };
          }),
        }),
      }),
    );
  }
});
