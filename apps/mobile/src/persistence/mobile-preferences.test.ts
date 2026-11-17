import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import * as MobilePreferences from "./mobile-preferences";
import * as MobileDatabase from "./mobile-database";
import * as MobileSecureStorage from "./mobile-secure-storage";

it.effect.each([
  { stored: null, expected: false },
  { stored: {}, expected: true },
  { stored: { settingsSyncEnabled: true }, expected: true },
  { stored: { settingsSyncEnabled: false }, expected: false },
])(
  "preserves sync for stored preferences $stored while new devices opt out",
  ({ stored, expected }) =>
    Effect.gen(function* () {
      const data = yield* Ref.make(
        stored === null
          ? Option.none<MobileDatabase.StoredPreferencesJson>()
          : Option.some({ payload: JSON.stringify(stored), updatedAt: 1 }),
      );
      const dependencies = Layer.mergeAll(
        Layer.mock(MobileDatabase.MobileDatabase)({
          loadPreferencesJson: Ref.get(data),
          savePreferencesJson: (payload, updatedAt) =>
            Ref.set(data, Option.some({ payload, updatedAt })),
        }),
        Layer.succeed(MobileSecureStorage.MobileSecureStorage, {
          getItem: () => Effect.succeed(null),
          setItem: () => Effect.void,
          removeItem: () => Effect.void,
        }),
      );
      yield* Effect.gen(function* () {
        const store = yield* MobilePreferences.MobilePreferencesStore;
        expect((yield* store.load).settingsSyncEnabled).toBe(expected);
        yield* store.savePatch({ language: "en" });
        expect((yield* store.load).settingsSyncEnabled).toBe(expected);
      }).pipe(Effect.provide(MobilePreferences.layer.pipe(Layer.provide(dependencies))));
    }),
);
