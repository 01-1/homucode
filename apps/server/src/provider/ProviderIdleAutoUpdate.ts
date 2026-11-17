import type {
  OrchestrationV2ThreadShell,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
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
 * Records which drivers worked since the last check, from threads working now or touched since,
 * and returns one update whose driver has had no work for the idle delay. Each instance and
 * version is returned once per process.
 */
export function pickIdleProviderUpdate(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly threads: ReadonlyArray<
    Pick<OrchestrationV2ThreadShell, "id" | "status" | "providerInstanceId">
  >;
  readonly touched: ReadonlySet<ThreadId>;
  readonly lastWorkingAt: Map<ProviderDriverKind, number>;
  readonly attempted: Set<string>;
  readonly now: number;
}): IdleProviderUpdate | null {
  const driverOf = new Map(input.providers.map((p) => [p.instanceId, p.driver] as const));
  for (const thread of input.threads) {
    const driver = driverOf.get(thread.providerInstanceId);
    if (
      driver !== undefined &&
      (WORKING_STATUSES.has(thread.status) || input.touched.has(thread.id))
    ) {
      input.lastWorkingAt.set(driver, input.now);
    }
  }
  const delay = Duration.toMillis(PROVIDER_IDLE_UPDATE_DELAY);
  for (const provider of input.providers) {
    if (!isAutoUpdatable(provider)) continue;
    const lastWorking = input.lastWorkingAt.get(provider.driver);
    if (lastWorking === undefined || input.now - lastWorking < delay) continue;
    const version = provider.versionAdvisory!.latestVersion!;
    const key = `${provider.instanceId}@${version}`;
    if (input.attempted.has(key)) continue;
    input.attempted.add(key);
    return { driver: provider.driver, instanceId: provider.instanceId, version };
  }
  return null;
}

/** Updates each provider on this server once none of its agents have worked for five minutes. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const engine = yield* Orchestrator.OrchestratorV2;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const runner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
    // The server's start counts as work, so a restart waits the full delay again.
    let idleSince = yield* Clock.currentTimeMillis;
    const lastWorkingAt = new Map<ProviderDriverKind, number>();
    const attempted = new Set<string>();
    // Threads with events since the last check, so a turn shorter than the interval still counts.
    let touched = new Set<ThreadId>();

    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        Effect.sync(() => {
          if (event.runId !== undefined || event.type.startsWith("run.")) {
            touched.add(event.threadId);
          }
        }),
      ),
    );

    const tick = Effect.gen(function* () {
      const seen = touched;
      touched = new Set();
      // Time spent switched off counts as work, so turning it on waits the full delay.
      if (!(yield* settings.getSettings).autoUpdateWhenIdle) {
        lastWorkingAt.clear();
        idleSince = yield* Clock.currentTimeMillis;
        return;
      }
      const current = yield* providers.getProviders;
      for (const provider of current) {
        if (!lastWorkingAt.has(provider.driver)) lastWorkingAt.set(provider.driver, idleSince);
      }
      const ids = new Set(seen);
      for (const entry of yield* threads.listActiveShellIndex()) {
        if (entry.mayBeLive) ids.add(entry.id);
      }
      const snapshot =
        ids.size === 0 ? null : yield* threads.getShellSnapshot({ threadIds: [...ids] });
      const shells = snapshot === null ? [] : [...snapshot.threads, ...snapshot.archivedThreads];
      const update = pickIdleProviderUpdate({
        providers: current,
        threads: shells,
        touched: seen,
        lastWorkingAt,
        attempted,
        now: yield* Clock.currentTimeMillis,
      });
      if (update === null) return;
      yield* Effect.logInfo("updating idle provider", update);
      yield* runner
        .updateProvider({ provider: update.driver, instanceId: update.instanceId })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("idle provider update failed", { ...update, error }),
          ),
        );
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => Effect.logWarning("idle provider update check failed", { cause }),
      ),
    );

    // One update per check, so the next update sees work that started during this one.
    yield* forkParked(tick.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL))));
  }),
).pipe(Layer.provide(ProviderMaintenanceRunner.layer));
