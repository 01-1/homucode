import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import * as Context from "effect/Context";

export class BackgroundGitEnabled extends Context.Reference<boolean>(
  "t3/vcs/BackgroundGitEnabled",
  { defaultValue: () => process.env.T3CODE_BACKGROUND_GIT !== "0" },
) {}

export const layer = Layer.effect(
  BackgroundGitEnabled,
  Effect.gen(function* () {
    const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings.pipe(
      Effect.orDie,
    );
    const override = yield* Config.option(Config.String("T3CODE_BACKGROUND_GIT"));
    return Option.isNone(override) ? settings.backgroundGitEnabled : override.value !== "0";
  }).pipe(Effect.orDie),
);
