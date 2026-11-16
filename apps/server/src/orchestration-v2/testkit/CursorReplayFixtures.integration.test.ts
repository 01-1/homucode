import { describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { withMessageTimestamp } from "../MessageTimestamp.ts";
import {
  MESSAGE_STEERING_INITIAL_PROMPT,
  MESSAGE_STEERING_STEER_PROMPT,
} from "./fixtures/shared.ts";

import { CursorOrchestratorReplayHarness } from "../Adapters/CursorAdapterV2.testkit.ts";
import { messageRestartInput } from "./fixtures/message_steering/input.ts";
import {
  findReplayFixture,
  itRunsReplayFixtures,
  runReplayFixture,
} from "./ProviderReplayFixtures.ts";

describe("Cursor replay fixtures", () => {
  itRunsReplayFixtures("cursor", (input) =>
    runReplayFixture({ ...input, harness: CursorOrchestratorReplayHarness }),
  );

  const cursorSteeringProvider = findReplayFixture("message_steering")?.providers.find(
    (provider) => provider.driver === "cursor",
  );
  if (cursorSteeringProvider !== undefined) {
    it.effect("executes explicit Cursor restart_active through the recorded SDK boundary", () =>
      runReplayFixture({
        fixtureName: "message_steering",
        buildInput: messageRestartInput,
        transformTranscript: (transcript) => ({
          ...transcript,
          entries: transcript.entries.map((entry) => {
            if (entry.type !== "expect_outbound" || entry.label !== "run.start:2") return entry;
            const frame = entry.frame;
            if (
              typeof frame !== "object" ||
              frame === null ||
              !("message" in frame) ||
              typeof frame.message !== "string"
            )
              return entry;
            const message = [MESSAGE_STEERING_INITIAL_PROMPT, MESSAGE_STEERING_STEER_PROMPT].reduce(
              (text, prompt) =>
                text.replace(
                  prompt,
                  withMessageTimestamp(prompt, {
                    text: prompt,
                    createdAt: DateTime.makeUnsafe(0),
                  }),
                ),
              frame.message,
            );
            return { ...entry, frame: { ...frame, message } };
          }),
        }),
        driver: {
          ...cursorSteeringProvider,
          transcriptFile: new URL(
            "./fixtures/message_steering/cursor_restart_transcript.ndjson",
            import.meta.url,
          ),
        },
        harness: CursorOrchestratorReplayHarness,
      }),
    );
  }
});
