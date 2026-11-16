// @effect-diagnostics nodeBuiltinImport:off -- automatic limits follow the host's RAM.
import * as NodeOS from "node:os";

import { type AgentMemorySettings } from "@t3tools/contracts";
import { AgentMemory, type AgentMemoryOwnerValue } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";

export const AGENT_SLICE = "app-t3code-agents.slice";
const GiB = 1024 ** 3;

export function agentMemoryLimits(settings: AgentMemorySettings, total: number) {
  const groupMax = settings.groupMaxBytes ?? Math.max(total - 4 * GiB, Math.floor(total * 0.75));
  const groupHigh = Math.min(
    groupMax,
    settings.groupHighBytes ?? Math.max(total - 6 * GiB, Math.floor(total / 2)),
  );
  const agentMax = Math.min(settings.perAgentMaxBytes, groupMax);
  return {
    groupHigh,
    groupMax,
    agentHigh: Math.min(settings.perAgentHighBytes, agentMax, groupHigh),
    agentMax,
    minimum: Math.min(settings.minimumReservationBytes, agentMax),
  };
}

export function agentReservation(current: number, minimum: number, cap: number, percent: number) {
  return Math.min(cap, Math.max(minimum, Math.ceil(current * (1 + percent / 100))));
}

interface Ticket {
  readonly id: string;
  readonly threadId: string;
  readonly reuseRuntimeId?: string;
  readonly requestedAt: number;
  readonly ready: Deferred.Deferred<void>;
  granted: boolean;
}

export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  if (platform !== "linux" || !environment.XDG_RUNTIME_DIR) return AgentMemory.defaultValue();
  const systemctl = yield* resolveCommandPath("systemctl", { env: environment });
  if (systemctl === null) return AgentMemory.defaultValue();
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const manager = yield* runner
    .run({
      command: systemctl,
      args: ["--user", "show", "--property=Version", "--value"],
      timeout: "5 seconds",
    })
    .pipe(Effect.option);
  if (manager._tag === "None" || manager.value.code !== 0) return AgentMemory.defaultValue();
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const settings = serverSettings.getSettings.pipe(
    Effect.map((value) => value.agentMemory),
    // A settings read failure must not silently remove the last configured limits.
    Effect.orDie,
  );
  const tickets = new Map<string, Ticket>();
  const ownersByUnit = new Map<string, AgentMemoryOwnerValue>();
  const restored = new Map<
    string,
    {
      readonly id: string;
      readonly requestedAt: number;
      readonly isPending: Effect.Effect<boolean>;
    }
  >();
  const lock = yield* Semaphore.make(1);
  let controlGroup: string | undefined;

  const readNumber = (directory: string, file: string) =>
    fileSystem.readFileString(path.join(directory, file)).pipe(
      Effect.map((text) => (/^\d+\s*$/.test(text) ? Number(text) : undefined)),
      Effect.orElseSucceed(() => undefined),
    );
  const readUsage = Effect.fn("AgentMemory.readUsage")(function* (config: AgentMemorySettings) {
    if (controlGroup === undefined) {
      const shown = yield* runner
        .run({
          command: systemctl,
          args: ["--user", "show", AGENT_SLICE, "--property=ControlGroup", "--value"],
          timeout: "5 seconds",
        })
        .pipe(Effect.option);
      if (shown._tag === "None" || shown.value.code !== 0 || !shown.value.stdout.trim()) return;
      controlGroup = path.join("/sys/fs/cgroup", shown.value.stdout.trim());
    }
    const groupCurrent = yield* readNumber(controlGroup, "memory.current");
    if (groupCurrent === undefined) return;
    const limits = agentMemoryLimits(config, NodeOS.totalmem());
    const kernelMax = yield* readNumber(controlGroup, "memory.max");
    const cap = Math.min(limits.groupMax, kernelMax ?? limits.groupMax);
    const minimum = Math.min(limits.minimum, cap);
    let measured = 0;
    let reserved = 0;
    const reservedByRuntime = new Map<string, number>();
    const reservedByTicket = new Map<string, number>();
    const seen = new Set<string>();
    const directories = [controlGroup];
    while (directories.length > 0) {
      const directory = directories.pop()!;
      const children = yield* fileSystem.readDirectory(directory).pipe(Effect.option);
      // Incomplete telemetry cannot grant another start.
      if (children._tag === "None") return;
      for (const name of children.value) {
        if (name.endsWith(".slice")) directories.push(path.join(directory, name));
        if (!name.startsWith("t3code-") || !name.endsWith(".scope")) continue;
        const current = yield* readNumber(path.join(directory, name), "memory.current");
        if (current === undefined) return;
        seen.add(name);
        const isAgent = !name.startsWith("t3code-terminal-") && !name.startsWith("t3code-browser-");
        const reservation = agentReservation(
          current,
          isAgent ? minimum : 0,
          Math.min(limits.agentMax, cap),
          config.headroomPercent,
        );
        measured += current;
        reserved += Math.max(current, reservation);
        const owner = ownersByUnit.get(name);
        if (owner !== undefined) {
          reservedByRuntime.set(
            owner.runtimeId,
            (reservedByRuntime.get(owner.runtimeId) ?? 0) + reservation,
          );
          reservedByTicket.set(
            owner.ticketId,
            (reservedByTicket.get(owner.ticketId) ?? 0) + reservation,
          );
        }
      }
    }
    for (const [unit, owner] of ownersByUnit) {
      if (!seen.has(unit) && !tickets.has(owner.ticketId)) ownersByUnit.delete(unit);
    }
    // Include memory in the slice but outside recognized scopes; never count a parent twice.
    reserved += Math.max(0, groupCurrent - measured);
    const credit = (ticket: Ticket) =>
      Math.max(
        reservedByTicket.get(ticket.id) ?? 0,
        ticket.reuseRuntimeId === undefined
          ? 0
          : (reservedByRuntime.get(ticket.reuseRuntimeId) ?? 0),
      );
    for (const ticket of tickets.values()) {
      if (ticket.granted) reserved += Math.max(0, minimum - credit(ticket));
    }
    return { cap, minimum, reserved, credit };
  });

  const pump = lock.withPermits(1)(
    Effect.gen(function* () {
      const config = yield* settings;
      if (!config.enabled) {
        for (const ticket of tickets.values()) {
          ticket.granted = true;
          yield* Deferred.succeed(ticket.ready, undefined);
        }
        return;
      }
      const usage = yield* readUsage(config);
      if (usage === undefined) return;
      const pending = [
        ...restored.values(),
        ...Array.from(tickets.values()).filter((t) => !t.granted),
      ].sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id));
      for (const candidate of pending) {
        const ticket = tickets.get(candidate.id);
        if (ticket === undefined) {
          if ("isPending" in candidate && (yield* candidate.isPending)) break;
          restored.delete(candidate.id);
          continue;
        }
        const additional = Math.max(0, usage.minimum - usage.credit(ticket));
        if (usage.reserved + additional > usage.cap) break;
        usage.reserved += additional;
        ticket.granted = true;
        yield* Deferred.succeed(ticket.ready, undefined);
      }
    }),
  );

  yield* forkParked(
    Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep((yield* settings).pollIntervalMs);
        yield* pump;
      }),
    ),
  );

  return AgentMemory.of({
    settings,
    track: Effect.fn("AgentMemory.track")((unit, owner) =>
      Effect.sync(() => {
        if (owner !== undefined) ownersByUnit.set(unit, owner);
      }),
    ),
    restore: Effect.fn("AgentMemory.restore")((waiters) =>
      lock.withPermits(1)(
        Effect.sync(() => {
          for (const waiter of waiters)
            if (!tickets.has(waiter.id)) restored.set(waiter.id, waiter);
        }),
      ),
    ),
    acquire: Effect.fn("AgentMemory.acquire")(function (input) {
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (!(yield* settings).enabled) return Effect.void;
          const ticket: Ticket = { ...input, ready: yield* Deferred.make<void>(), granted: false };
          const release = Effect.sync(() => {
            if (tickets.get(ticket.id) === ticket) tickets.delete(ticket.id);
          });
          yield* Effect.addFinalizer(() => release);
          restored.delete(ticket.id);
          tickets.set(ticket.id, ticket);
          yield* restore(
            Effect.gen(function* () {
              yield* pump;
              if (!ticket.granted) yield* input.onWaiting;
              yield* Deferred.await(ticket.ready);
            }),
          ).pipe(Effect.onExit((exit) => (exit._tag === "Failure" ? release : Effect.void)));
          return release;
        }),
      );
    }),
  });
});

export const layer = Layer.effect(AgentMemory, make).pipe(Layer.provide(ProcessRunner.layer));
