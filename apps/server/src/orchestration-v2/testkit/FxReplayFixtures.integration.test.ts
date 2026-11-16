import { describe } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { FxOrchestratorReplayHarness } from "../Adapters/FxAdapterV2.testkit.ts";
import { itRunsReplayFixtures, runReplayFixture } from "./ProviderReplayFixtures.ts";
import { materializeReplayPromptTimestamps } from "./ReplayMessageTimestamps.ts";
import { MULTI_TURN_SECOND_PROMPT } from "./fixtures/shared.ts";

describe("fx replay fixtures", () => {
  itRunsReplayFixtures("fx", (input) =>
    runReplayFixture({
      ...input,
      harness: FxOrchestratorReplayHarness,
      transformTranscript: (transcript) =>
        materializeReplayPromptTimestamps(
          transcript,
          [MULTI_TURN_SECOND_PROMPT],
          DateTime.makeUnsafe(0),
        ),
    }),
  );
});
