import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { vi } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("../lib/runtime", async () => {
  const Layer = await import("effect/Layer");
  return {
    runtime: { runPromise: vi.fn() },
    layer: Layer.empty,
  };
});

import { createMobilePreferencesState } from "./preferences";
import { useAtomCommand } from "./use-atom-command";
import * as MobilePreferences from "../persistence/mobile-preferences";

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((resume) => {
    resolve = resume;
  });
  return { promise, resolve } as const;
}

function makePreferencesState(
  service: Omit<
    MobilePreferences.MobilePreferencesStore["Service"],
    "update" | "settingsSyncDefault"
  > &
    Partial<
      Pick<MobilePreferences.MobilePreferencesStore["Service"], "update" | "settingsSyncDefault">
    >,
) {
  const completeService = MobilePreferences.MobilePreferencesStore.of({
    settingsSyncDefault: Effect.succeed(false),
    ...service,
    update:
      service.update ??
      ((transform) =>
        service.load.pipe(
          Effect.flatMap((current) => service.savePatch(transform(current))),
          Effect.mapError((cause) =>
            cause._tag === "MobilePreferencesSaveError"
              ? cause
              : new MobilePreferences.MobilePreferencesSaveError({ cause }),
          ),
        )),
  });
  return createMobilePreferencesState(
    Atom.runtime(Layer.succeed(MobilePreferences.MobilePreferencesStore, completeService)),
  );
}

describe("mobile preferences state", () => {
  it.effect.each([false, true])(
    "keeps optimistic snoozes out of persisted preferences until storage settles (failure %s)",
    (fail) =>
      Effect.gen(function* () {
        const stored = { featureOffersSnoozedUntil: "2026-11-19T12:00:00.000Z" };
        const patch = { featureOffersSnoozedUntil: "2026-11-20T12:00:00.000Z" };
        const started = yield* Deferred.make<void>();
        const saved = yield* Deferred.make<
          MobilePreferences.Preferences,
          MobilePreferences.MobilePreferencesSaveError
        >();
        const state = makePreferencesState({
          load: Effect.succeed(stored),
          savePatch: () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(saved))),
        });
        const registry = AtomRegistry.make();
        const unmount = registry.mount(state.preferencesAtom);
        yield* AtomRegistry.getResult(registry, state.preferencesAtom, { suspendOnWaiting: true });
        registry.set(state.updatePreferencesAtom, patch);
        yield* Deferred.await(started);
        expect(yield* AtomRegistry.getResult(registry, state.preferencesAtom)).toEqual(patch);
        expect(yield* AtomRegistry.getResult(registry, state.persistedPreferencesAtom)).toEqual(
          stored,
        );
        if (fail)
          yield* Deferred.fail(
            saved,
            new MobilePreferences.MobilePreferencesSaveError({ cause: "disk full" }),
          );
        else yield* Deferred.succeed(saved, patch);
        yield* AtomRegistry.getResult(registry, state.updatePreferencesAtom, {
          suspendOnWaiting: true,
        }).pipe(Effect.exit);
        expect(yield* AtomRegistry.getResult(registry, state.persistedPreferencesAtom)).toEqual(
          fail ? stored : patch,
        );
        expect(yield* AtomRegistry.getResult(registry, state.preferencesAtom)).toEqual(
          fail ? stored : patch,
        );
        unmount();
        registry.dispose();
      }),
  );
  it.effect("preserves an optimistic patch when the initial load finishes later", () =>
    Effect.gen(function* () {
      const pendingLoad = deferred<MobilePreferences.Preferences>();
      const savePatch = vi.fn((patch: Partial<MobilePreferences.Preferences>) =>
        Effect.succeed(patch),
      );
      const state = makePreferencesState({
        load: Effect.promise(() => pendingLoad.promise),
        savePatch,
      });
      const registry = AtomRegistry.make();
      const unmountPreferences = registry.mount(state.preferencesAtom);

      const save = yield* Effect.forkChild(
        Effect.exit(
          state.savePreferences.run(registry, {
            collapsedProjectGroups: ["project:new"],
          }),
        ),
        { startImmediately: true },
      );
      pendingLoad.resolve({
        baseFontSize: 18,
        collapsedProjectGroups: ["project:old"],
      });

      const preferences = yield* AtomRegistry.getResult(registry, state.preferencesAtom, {
        suspendOnWaiting: true,
      });
      const saveResult = yield* Fiber.join(save);
      expect(preferences).toEqual({
        baseFontSize: 18,
        collapsedProjectGroups: ["project:new"],
      });
      expect(savePatch).toHaveBeenCalledWith({
        collapsedProjectGroups: ["project:new"],
      });
      expect(Exit.isFailure(saveResult)).toBe(false);

      unmountPreferences();
      registry.dispose();
    }),
  );

  it.effect("keeps both favorites when the React command sends updates before a render", () =>
    Effect.gen(function* () {
      let persisted: MobilePreferences.Preferences = { modelFavorites: [] };
      const state = makePreferencesState({
        load: Effect.succeed(persisted),
        savePatch: (patch) =>
          Effect.sync(() => {
            persisted = { ...persisted, ...patch };
            return persisted;
          }),
        update: (transform) =>
          Effect.sync(() => {
            persisted = { ...persisted, ...transform(persisted) };
            return persisted;
          }),
      });
      const registry = AtomRegistry.make();
      const unmountPreferences = registry.mount(state.preferencesAtom);
      yield* AtomRegistry.getResult(registry, state.preferencesAtom, { suspendOnWaiting: true });

      function useSavePreferences() {
        return useAtomCommand(state.savePreferences, { reportFailure: false });
      }
      const setters: Array<ReturnType<typeof useSavePreferences>> = [];
      function CaptureSetter() {
        setters.push(useSavePreferences());
        return null;
      }
      renderToString(
        createElement(RegistryContext.Provider, { value: registry }, createElement(CaptureSetter)),
      );
      const savePreferences = setters[0]!;
      const provider = ProviderInstanceId.make("codex");
      const first = savePreferences({
        transform: (current) => ({
          modelFavorites: [...(current.modelFavorites ?? []), { provider, model: "astra" }],
        }),
      });
      const second = savePreferences({
        transform: (current) => ({
          modelFavorites: [...(current.modelFavorites ?? []), { provider, model: "sol" }],
        }),
      });
      yield* Effect.promise(() => Promise.all([first, second]));

      expect(persisted.modelFavorites).toEqual([
        { provider, model: "astra" },
        { provider, model: "sol" },
      ]);

      yield* Effect.promise(() =>
        savePreferences({
          transform: (current) => ({
            modelFavorites: (current.modelFavorites ?? []).filter(
              (favorite) => favorite.model !== "astra",
            ),
          }),
        }),
      );
      expect(persisted.modelFavorites).toEqual([{ provider, model: "sol" }]);

      unmountPreferences();
      registry.dispose();
    }),
  );

  it.effect.each([
    { stored: {}, defaultEnabled: false, expected: false },
    { stored: {}, defaultEnabled: true, expected: true },
    { stored: { settingsSyncEnabled: false }, defaultEnabled: true, expected: false },
    { stored: { settingsSyncEnabled: true }, defaultEnabled: false, expected: true },
  ])(
    "resolves sync from $stored with default $defaultEnabled",
    ({ stored, defaultEnabled, expected }) =>
      Effect.gen(function* () {
        let persisted: MobilePreferences.Preferences = stored;
        const state = makePreferencesState({
          load: Effect.succeed(stored),
          settingsSyncDefault: Effect.succeed(defaultEnabled),
          savePatch: (patch) =>
            Effect.sync(() => {
              persisted = { ...persisted, ...patch };
              return persisted;
            }),
        });
        const registry = AtomRegistry.make();
        const unmount = registry.mount(state.preferencesAtom);
        expect(
          yield* AtomRegistry.getResult(registry, state.preferencesAtom, {
            suspendOnWaiting: true,
          }),
        ).toEqual(stored);
        expect(registry.get(state.settingsSyncEnabledAtom)).toBe(expected);
        registry.set(state.updatePreferencesAtom, { settingsSyncEnabled: !expected });
        yield* AtomRegistry.getResult(registry, state.updatePreferencesAtom, {
          suspendOnWaiting: true,
        });
        expect(registry.get(state.settingsSyncEnabledAtom)).toBe(!expected);
        expect(persisted.settingsSyncEnabled).toBe(!expected);
        unmount();
        registry.dispose();
      }),
  );

  it.effect("clears the optimistic patch when a save is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const store = {
        load: Effect.succeed({ baseFontSize: 16 }),
        savePatch: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      };
      const state = makePreferencesState(store);
      const registry = AtomRegistry.make();
      const unmount = registry.mount(state.preferencesAtom);
      yield* AtomRegistry.getResult(registry, state.preferencesAtom, { suspendOnWaiting: true });

      const fiber = yield* Effect.forkChild(
        state.save({ baseFontSize: 20 }, registry).pipe(
          Effect.provide(
            Layer.succeed(
              MobilePreferences.MobilePreferencesStore,
              MobilePreferences.MobilePreferencesStore.of({
                ...store,
                settingsSyncDefault: Effect.succeed(false),
                update: () => Effect.die("unexpected"),
              }),
            ),
          ),
        ),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);

      expect(AsyncResult.getOrElse(registry.get(state.preferencesAtom), () => ({}))).toEqual({
        baseFontSize: 16,
      });
      unmount();
      registry.dispose();
    }),
  );

  it.effect("falls back to empty preferences when secure storage cannot be read", () =>
    Effect.gen(function* () {
      const state = makePreferencesState({
        load: Effect.fail(
          new MobilePreferences.MobilePreferencesLoadError({
            cause: new Error("secure storage unavailable"),
          }),
        ),
        savePatch: (patch) => Effect.succeed(patch),
      });
      const registry = AtomRegistry.make();
      const unmount = registry.mount(state.preferencesAtom);

      expect(
        yield* AtomRegistry.getResult(registry, state.preferencesAtom, {
          suspendOnWaiting: true,
        }),
      ).toEqual({});

      unmount();
      registry.dispose();
    }),
  );
});
