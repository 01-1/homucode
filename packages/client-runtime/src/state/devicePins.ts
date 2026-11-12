import {
  threadPinForDevice,
  legacyThreadPin,
  IsoDateTime,
  type EnvironmentId,
  type OrchestrationV2ShellSnapshot,
  type ProjectId,
} from "@t3tools/contracts";
import { hashTelemetryId } from "@t3tools/shared/telemetryId";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { AnalyticsDevice } from "../platform/capabilities.ts";
import { createRuntimeCommand } from "./runtime.ts";

export const DevicePinsState = Schema.Struct({
  projects: Schema.Record(Schema.String, Schema.NullOr(IsoDateTime)),
});
export type DevicePinsState = typeof DevicePinsState.Type;
const isDevicePinsState = Schema.is(DevicePinsState);

export interface DevicePinsStorage {
  readonly load: (environmentId: EnvironmentId) => Promise<unknown>;
  readonly save: (environmentId: EnvironmentId, pins: DevicePinsState) => Promise<void>;
}

export class DevicePinsPersistenceError extends Schema.TaggedError<DevicePinsPersistenceError>()(
  "DevicePinsPersistenceError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Could not save pins on this device.";
  }
}

export function createDeviceIdentityAtom<R, E>(runtime: Atom.AtomRuntime<R, E>) {
  return runtime.atom(Effect.gen(function* () {
    const identity = yield* (yield* AnalyticsDevice).id;
    if (Option.isNone(identity)) return yield* new DevicePinsPersistenceError({ cause: "The device identity is unavailable." });
    return hashTelemetryId(identity.value);
  })).pipe(Atom.keepAlive);
}

export function createDevicePins(
  sourceSnapshotAtom: (environmentId: EnvironmentId) => Atom.Atom<OrchestrationV2ShellSnapshot | null>,
  deviceIdAtom: Atom.Atom<AsyncResult.AsyncResult<string, unknown>>,
  storage: DevicePinsStorage,
) {
  const runtime = Atom.runtime(Layer.empty);
  const seedAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): DevicePinsState | null => {
      const previous = Option.getOrNull(get.self<DevicePinsState | null>());
      if (previous !== null) return previous;
      const snapshot = get(sourceSnapshotAtom(environmentId));
      return snapshot === null ? null : {
        projects: Object.fromEntries(snapshot.projects.map((project) => [project.id, project.pinnedAt ?? null])),
      };
    }).pipe(Atom.keepAlive),
  );
  const storedAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom((get) => {
      const seed = get(seedAtom(environmentId));
      if (seed === null) return Effect.never;
      return Effect.tryPromise({
        try: async () => {
          const stored = await storage.load(environmentId);
          if (isDevicePinsState(stored)) return stored;
          // Each client freezes its own legacy project seed; no server records are changed.
          await storage.save(environmentId, seed);
          return seed;
        },
        catch: (cause) => new DevicePinsPersistenceError({ cause }),
      });
    }).pipe(Atom.keepAlive),
  );
  const confirmedAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<DevicePinsState | null>(null).pipe(Atom.keepAlive),
  );
  const stateAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => get(confirmedAtom(environmentId)) ?? AsyncResult.getOrElse(get(storedAtom(environmentId)), () => null)),
  );
  const setProject = createRuntimeCommand(runtime, {
    label: "device-pins:project",
    concurrency: { mode: "serial", key: (target: { environmentId: EnvironmentId; projectId: ProjectId; pinned: boolean }) => target.environmentId },
    execute: (target, registry) => Effect.gen(function* () {
      const loaded = yield* AtomRegistry.getResult(registry, storedAtom(target.environmentId), { suspendOnWaiting: true });
      const current = registry.get(confirmedAtom(target.environmentId)) ?? loaded;
      const next = { projects: { ...current.projects, [target.projectId]: target.pinned ? current.projects[target.projectId] ?? DateTime.formatIso(DateTime.nowUnsafe()) : null } };
      yield* Effect.tryPromise({
        try: () => storage.save(target.environmentId, next),
        catch: (cause) => new DevicePinsPersistenceError({ cause }),
      });
      registry.set(confirmedAtom(target.environmentId), next);
    }),
  });
  const wrapSnapshot = (source: typeof sourceSnapshotAtom) => Atom.family((environmentId: EnvironmentId) => {
    const threadCache = new WeakMap<OrchestrationV2ShellSnapshot["threads"][number], { deviceId: string; value: OrchestrationV2ShellSnapshot["threads"][number] }>();
    const projectCache = new WeakMap<OrchestrationV2ShellSnapshot["projects"][number], { pinnedAt: string | null; value: OrchestrationV2ShellSnapshot["projects"][number] }>();
    return Atom.make((get): OrchestrationV2ShellSnapshot | null => {
      const snapshot = get(source(environmentId));
      const projects = get(stateAtom(environmentId));
      const deviceId = AsyncResult.getOrElse(get(deviceIdAtom), () => null);
      if (snapshot === null) return snapshot;
      return {
        ...snapshot,
        threads: snapshot.threads.map((thread) => {
          const cached = threadCache.get(thread);
          if (cached?.deviceId === (deviceId ?? "")) return cached.value;
          const pin = deviceId === null ? legacyThreadPin(thread) : threadPinForDevice(thread, deviceId);
          const value = { ...thread, pinnedAt: pin === null ? null : DateTime.makeUnsafe(pin.pinnedAt), pinOrderKey: pin?.orderKey ?? null };
          threadCache.set(thread, { deviceId: deviceId ?? "", value });
          return value;
        }),
        projects: projects === null ? snapshot.projects : snapshot.projects.map((project) => {
          const pinnedAt = projects.projects[project.id] ?? null;
          const cached = projectCache.get(project);
          if (cached?.pinnedAt === pinnedAt) return cached.value;
          const value = { ...project, pinnedAt };
          projectCache.set(project, { pinnedAt, value });
          return value;
        }),
      };
    });
  });
  return { stateAtom, deviceIdAtom, wrapSnapshot, setProject };
}

export type DevicePins = ReturnType<typeof createDevicePins>;
