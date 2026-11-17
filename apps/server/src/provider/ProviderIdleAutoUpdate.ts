import type {
  OrchestrationV2ThreadShell,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as ProviderMaintenanceRunner from "./providerMaintenanceRunner.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const PROVIDER_IDLE_UPDATE_DELAY = Duration.minutes(5);
const CHECK_INTERVAL = Duration.minutes(1);

const WORKING_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

export interface IdleProviderUpdate {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly version: string;
}

const isAutoUpdatable = (provider: ServerProvider) =>
  provider.enabled &&
  provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
  provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
  provider.versionAdvisory?.status === "behind_latest" &&
  provider.versionAdvisory.canUpdate === true &&
  provider.versionAdvisory.updateCommand !== null &&
  provider.versionAdvisory.latestVersion !== null &&
  provider.updateState?.status !== "queued" &&
  provider.updateState?.status !== "running";

/**
 * Records which drivers have agents working now and returns the updates whose driver has had
 * none for the idle delay. Each instance and version is returned once per process.
 */
export function pickIdleProviderUpdates(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly threads: ReadonlyArray<
    Pick<OrchestrationV2ThreadShell, "status" | "providerInstanceId">
  >;
  readonly lastWorkingAt: Map<ProviderDriverKind, number>;
  readonly attempted: Set<string>;
  readonly now: number;
}): ReadonlyArray<IdleProviderUpdate> {
  const driverOf = new Map(input.providers.map((p) => [p.instanceId, p.driver] as const));
  for (const thread of input.threads) {
    const driver = driverOf.get(thread.providerInstanceId);
    if (driver !== undefined && WORKING_STATUSES.has(thread.status)) {
      input.lastWorkingAt.set(driver, input.now);
    }
  }
  const delay = Duration.toMillis(PROVIDER_IDLE_UPDATE_DELAY);
  return input.providers.flatMap((provider) => {
    if (!isAutoUpdatable(provider)) return [];
    const lastWorking = input.lastWorkingAt.get(provider.driver);
    if (lastWorking === undefined || input.now - lastWorking < delay) return [];
    const version = provider.versionAdvisory!.latestVersion!;
    const key = `${provider.instanceId}@${version}`;
    if (input.attempted.has(key)) return [];
    input.attempted.add(key);
    return [{ driver: provider.driver, instanceId: provider.instanceId, version }];
  });
}

/** Updates each provider on this server once none of its agents have worked for five minutes. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const runner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
    const startedAt = yield* Clock.currentTimeMillis;
    const lastWorkingAt = new Map<ProviderDriverKind, number>();
    const attempted = new Set<string>();

    const tick = Effect.gen(function* () {
      if (!(yield* settings.getSettings).autoUpdateWhenIdle) return;
      const current = yield* providers.getProviders;
      // Count the server's start as work, so a restart waits the full delay again.
      for (const provider of current) {
        if (!lastWorkingAt.has(provider.driver)) lastWorkingAt.set(provider.driver, startedAt);
      }
      const live = (yield* threads.listActiveShellIndex()).filter((entry) => entry.mayBeLive);
      const shells =
        live.length === 0
          ? []
          : (yield* threads.getShellSnapshot({ threadIds: live.map((entry) => entry.id) })).threads;
      const updates = pickIdleProviderUpdates({
        providers: current,
        threads: shells,
        lastWorkingAt,
        attempted,
        now: yield* Clock.currentTimeMillis,
      });
      yield* Effect.forEach(
        updates,
        (update) =>
          Effect.logInfo("updating idle provider", update).pipe(
            Effect.andThen(
              runner.updateProvider({
                provider: update.driver,
                instanceId: update.instanceId,
              }),
            ),
            Effect.catch((error) =>
              Effect.logWarning("idle provider update failed", { ...update, error }),
            ),
          ),
        { discard: true },
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("idle provider update check failed", { cause }),
      ),
    );

    yield* forkParked(tick.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL))));
  }),
).pipe(Layer.provide(ProviderMaintenanceRunner.layer));
