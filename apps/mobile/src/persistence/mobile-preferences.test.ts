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
  { stored: { settingsSyncBases: { server: { revision: 1, values: {} } } }, expected: true },
  { stored: { settingsSyncEnabled: true }, expected: true },
  { stored: { settingsSyncEnabled: false }, expected: false },
  {
    stored: { featureOffersDraft: { environmentId: "server", selected: ["sent-from"], step: 2 } },
    expected: true,
  },
  {
    stored: {
      featureOffersDraft: { environmentId: "server", selected: ["sent-from"], step: 2 },
      featureOffersDrafts: {
        server: { environmentId: "server", selected: ["sent-from"], step: 2 },
        remote: { environmentId: "remote", selected: ["building-t3"], step: 1 },
      },
      featureOffersSnoozedUntil: "2026-11-19T14:30:00.000Z",
    },
    expected: true,
  },
])(
  "preserves sync for stored preferences $stored while new devices opt out",
  ({ stored, expected }) =>
    Effect.gen(function* () {
      const data = yield* Ref.make(
        stored === null
          ? Option.none<MobileDatabase.StoredPreferencesJson>()
          : Option.some({ payload: JSON.stringify(stored), updatedAt: 1 }),
      );
      const metadata = yield* Ref.make<Record<string, string>>({});
      const dependencies = Layer.mergeAll(
        Layer.mock(MobileDatabase.MobileDatabase)({
          loadPreferencesJson: Ref.get(data),
          savePreferencesJson: (payload, updatedAt) =>
            Ref.set(data, Option.some({ payload, updatedAt })),
        }),
        Layer.succeed(MobileSecureStorage.MobileSecureStorage, {
          getItem: (key) => Ref.get(metadata).pipe(Effect.map((values) => values[key] ?? null)),
          setItem: (key, value) => Ref.update(metadata, (values) => ({ ...values, [key]: value })),
          removeItem: () => Effect.void,
        }),
      );
      const storage = MobilePreferences.layer.pipe(Layer.provide(dependencies));
      yield* Effect.gen(function* () {
        const store = yield* MobilePreferences.MobilePreferencesStore;
        const preferences = yield* store.load;
        expect(preferences).toEqual(stored ?? {});
        expect(preferences.settingsSyncEnabled ?? (yield* store.settingsSyncDefault)).toBe(
          expected,
        );
        expect(yield* store.savePatch({ language: "en" })).toEqual({ ...stored, language: "en" });
      }).pipe(Effect.provide(Layer.fresh(storage)));
      yield* Effect.gen(function* () {
        const store = yield* MobilePreferences.MobilePreferencesStore;
        const preferences = yield* store.load;
        expect(preferences).toEqual({ ...stored, language: "en" });
        expect(preferences.settingsSyncEnabled ?? (yield* store.settingsSyncDefault)).toBe(
          expected,
        );
      }).pipe(Effect.provide(Layer.fresh(storage)));
    }),
);
