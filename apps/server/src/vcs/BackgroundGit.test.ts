import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import * as BackgroundGit from "./BackgroundGit.ts";

it.effect.each([
  { saved: false, override: undefined, expected: false },
  { saved: true, override: undefined, expected: true },
  { saved: true, override: "0", expected: false },
  { saved: false, override: "1", expected: true },
])(
  "loads background Git $saved with override $override as $expected",
  ({ saved, override, expected }) =>
    Effect.gen(function* () {
      const enabled = yield* BackgroundGit.BackgroundGitEnabled;
      expect(enabled).toBe(expected);
      yield* (yield* ServerSettings.ServerSettingsService).updateSettings({
        backgroundGitEnabled: !saved,
      });
      expect(yield* BackgroundGit.BackgroundGitEnabled).toBe(expected);
    }).pipe(
      Effect.provide(
        BackgroundGit.layer.pipe(
          Layer.provideMerge(ServerSettings.layerTest({ backgroundGitEnabled: saved })),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown(
                override === undefined ? {} : { T3CODE_BACKGROUND_GIT: override },
              ),
            ),
          ),
        ),
      ),
    ),
);
