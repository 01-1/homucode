// @effect-diagnostics nodeBuiltinImport:off -- fake cgroups and systemctl live in a temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_AGENT_MEMORY_SETTINGS } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import { agentMemoryLimits, agentReservation, make } from "./agentMemory.ts";

const GiB = 1024 ** 3;

const withGovernor = <A, E>(
  body: (fixture: {
    readonly memory: Effect.Success<typeof make>;
    readonly settings: ServerSettings.ServerSettingsService["Service"];
    readonly root: string;
    readonly scope: (unit: string, bytes: number) => void;
    readonly group: (bytes: number) => void;
  }) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-memory-test-"))),
        (directory) =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      );
      NodeFS.writeFileSync(NodePath.join(root, "systemctl"), "", { mode: 0o755 });
      const agents = NodePath.join(root, "agents");
      NodeFS.mkdirSync(agents);
      const group = (bytes: number) =>
        NodeFS.writeFileSync(NodePath.join(agents, "memory.current"), String(bytes));
      group(0);
      NodeFS.writeFileSync(NodePath.join(agents, "memory.max"), String(3 * GiB));
      const scope = (unit: string, bytes: number) => {
        NodeFS.mkdirSync(NodePath.join(agents, unit), { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(agents, unit, "memory.current"),
          String(Math.ceil(bytes)),
        );
        group(Math.ceil(bytes));
      };
      const fileSystem = yield* FileSystem.FileSystem;
      const settings = yield* ServerSettings.ServerSettingsService;
      const memory = yield* make.pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, {
          PATH: root,
          XDG_RUNTIME_DIR: "/run/user/test",
        }),
        Effect.provideService(ProcessRunner.ProcessRunner, {
          run: () =>
            Effect.succeed({
              stdout: "/agents\n",
              stderr: "",
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            }),
        }),
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          readFileString: (path, encoding) =>
            fileSystem.readFileString(path.replace("/sys/fs/cgroup", root), encoding),
          readDirectory: (path) => fileSystem.readDirectory(path.replace("/sys/fs/cgroup", root)),
        }),
      );
      return yield* body({ memory, settings, root: agents, scope, group });
    }),
  ).pipe(
    Effect.provide(
      ServerSettings.layerTest({ agentMemory: { groupMaxBytes: 3 * GiB } }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const acquire = (
  memory: Effect.Success<typeof make>,
  id: string,
  onWaiting: Effect.Effect<unknown> = Effect.void,
  requestedAt = 0,
) => memory.acquire({ id, threadId: id, requestedAt, onWaiting: onWaiting.pipe(Effect.asVoid) });

describe("agent reservations", () => {
  it("reserves a floor, follows usage, and truncates headroom at the smaller cap", () => {
    expect(agentReservation(100, 150, 800, 10)).toBe(150);
    expect(agentReservation(500, 150, 800, 10)).toBe(550);
    expect(agentReservation(750, 150, 800, 10)).toBe(800);
    expect(agentReservation(900, 150, 800, 10)).toBe(800);
    expect(
      agentMemoryLimits({ ...DEFAULT_AGENT_MEMORY_SETTINGS, groupMaxBytes: GiB / 2 }, 32 * GiB),
    ).toMatchObject({
      agentMax: GiB / 2,
      agentHigh: GiB / 2,
      minimum: GiB / 2,
      groupHigh: GiB / 2,
    });
  });

  it.effect(
    "counts concurrent starts before their scopes exist and releases cancelled waiters",
    () =>
      withGovernor(({ memory }) =>
        Effect.gen(function* () {
          const releaseA = yield* acquire(memory, "a");
          const releaseB = yield* acquire(memory, "b");
          const releaseC = yield* acquire(memory, "c");
          const waitingD = yield* Deferred.make<void>();
          const waitingE = yield* Deferred.make<void>();
          const d = yield* acquire(memory, "d", Deferred.succeed(waitingD, undefined), 1).pipe(
            Effect.forkChild,
          );
          yield* Deferred.await(waitingD);
          const e = yield* acquire(memory, "e", Deferred.succeed(waitingE, undefined), 2).pipe(
            Effect.forkChild,
          );
          yield* Deferred.await(waitingE);
          yield* Fiber.interrupt(d);
          yield* releaseB;
          yield* TestClock.adjust("2 seconds");
          const releaseE = yield* Fiber.join(e);
          yield* releaseE;
          yield* releaseA;
          yield* releaseC;
        }),
      ),
  );

  it.effect(
    "recomputes headroom from cgroups, transfers startup reservations, and admits FIFO",
    () =>
      withGovernor(({ memory, scope, group }) =>
        Effect.gen(function* () {
          const releaseA = yield* acquire(memory, "a");
          scope("t3code-claude-a.scope", 1.9 * GiB);
          yield* memory.track("t3code-claude-a.scope", {
            runtimeId: "runtime-a",
            ticketId: "a",
            isolated: false,
          });
          const waitingB = yield* Deferred.make<void>();
          const b = yield* acquire(memory, "b", Deferred.succeed(waitingB, undefined), 1).pipe(
            Effect.forkChild,
          );
          yield* Deferred.await(waitingB);
          const waitingC = yield* Deferred.make<void>();
          const c = yield* acquire(memory, "c", Deferred.succeed(waitingC, undefined), 2).pipe(
            Effect.forkChild,
          );
          yield* Deferred.await(waitingC);
          scope("t3code-claude-a.scope", 1.5 * GiB);
          yield* TestClock.adjust("2 seconds");
          const releaseB = yield* Fiber.join(b);
          expect(c.pollUnsafe()).toBeUndefined();
          // A live scope already supplies a's floor; its admission ticket must not add a second one.
          scope("t3code-claude-a.scope", GiB / 2);
          group(GiB / 2);
          yield* TestClock.adjust("2 seconds");
          const releaseC = yield* Fiber.join(c);
          yield* releaseA;
          yield* releaseB;
          yield* releaseC;
        }),
      ),
  );

  it.effect("credits only a reused runtime, never another scope from the same thread", () =>
    withGovernor(({ memory, scope }) =>
      Effect.gen(function* () {
        scope("t3code-codex-old.scope", 2.2 * GiB);
        yield* memory.track("t3code-codex-old.scope", {
          runtimeId: "shared",
          ticketId: "old-start",
          isolated: false,
        });
        const releaseReuse = yield* memory.acquire({
          id: "reuse",
          threadId: "same-thread",
          reuseRuntimeId: "shared",
          requestedAt: 0,
          onWaiting: Effect.die("A reused runtime already has its floor"),
        });
        const waiting = yield* Deferred.make<void>();
        const fresh = yield* memory
          .acquire({
            id: "fresh",
            threadId: "same-thread",
            requestedAt: 1,
            onWaiting: Deferred.succeed(waiting, undefined).pipe(Effect.asVoid),
          })
          .pipe(Effect.forkChild);
        yield* Deferred.await(waiting);
        expect(fresh.pollUnsafe()).toBeUndefined();
        yield* Fiber.interrupt(fresh);
        yield* releaseReuse;
      }),
    ),
  );

  it.effect("restores FIFO before workers register and prunes cancelled restored waiters", () =>
    withGovernor(({ memory, root }) =>
      Effect.gen(function* () {
        NodeFS.writeFileSync(NodePath.join(root, "memory.max"), String(GiB));
        yield* memory.restore([
          { id: "cancelled", requestedAt: 0, isPending: Effect.succeed(false) },
          { id: "older", requestedAt: 1, isPending: Effect.succeed(true) },
        ]);
        const waiting = yield* Deferred.make<void>();
        const younger = yield* acquire(
          memory,
          "younger",
          Deferred.succeed(waiting, undefined),
          2,
        ).pipe(Effect.forkChild);
        yield* Deferred.await(waiting);
        expect(younger.pollUnsafe()).toBeUndefined();
        const releaseOlder = yield* acquire(memory, "older", Effect.void, 1);
        expect(younger.pollUnsafe()).toBeUndefined();
        yield* releaseOlder;
        yield* TestClock.adjust("2 seconds");
        yield* yield* Fiber.join(younger);
      }),
    ),
  );

  it.effect("raises a saturated group cap before admitting a queued start", () =>
    withGovernor(({ memory, root, settings }) =>
      Effect.gen(function* () {
        yield* memory.setLimitUpdater(
          Effect.gen(function* () {
            const config = (yield* settings.getSettings).agentMemory;
            NodeFS.writeFileSync(NodePath.join(root, "memory.max"), String(config.groupMaxBytes));
          }),
        );
        const releaseA = yield* acquire(memory, "a");
        const releaseB = yield* acquire(memory, "b");
        const releaseC = yield* acquire(memory, "c");
        const waiting = yield* Deferred.make<void>();
        const fourth = yield* acquire(memory, "d", Deferred.succeed(waiting, undefined)).pipe(
          Effect.forkChild,
        );
        yield* Deferred.await(waiting);
        yield* settings.updateSettings({ agentMemory: { groupMaxBytes: 4 * GiB } });
        yield* TestClock.adjust("2 seconds");
        const releaseD = yield* Fiber.join(fourth);
        yield* releaseA;
        yield* releaseB;
        yield* releaseC;
        yield* releaseD;
      }),
    ),
  );

  it.effect("keeps starts waiting on missing telemetry and wakes them when disabled", () =>
    withGovernor(({ memory, settings, root }) =>
      Effect.gen(function* () {
        NodeFS.unlinkSync(NodePath.join(root, "memory.current"));
        const waiting = yield* Deferred.make<void>();
        const start = yield* acquire(memory, "a", Deferred.succeed(waiting, undefined)).pipe(
          Effect.forkChild,
        );
        yield* Deferred.await(waiting);
        yield* TestClock.adjust("2 seconds");
        expect(start.pollUnsafe()).toBeUndefined();
        yield* settings.updateSettings({ agentMemory: { enabled: false } });
        yield* TestClock.adjust("2 seconds");
        yield* yield* Fiber.join(start);
      }),
    ),
  );

  it.effect("truncates headroom at an existing scope's actual hard cap", () =>
    withGovernor(({ memory, root, scope }) =>
      Effect.gen(function* () {
        scope("t3code-claude-capped.scope", 1.9 * GiB);
        NodeFS.writeFileSync(
          NodePath.join(root, "t3code-claude-capped.scope", "memory.max"),
          String(2 * GiB),
        );
        const release = yield* acquire(
          memory,
          "b",
          Effect.die("The existing scope cannot reserve above its 2 GiB hard cap"),
        );
        yield* release;
      }),
    ),
  );

  it.effect("accounts for other slice consumers and the actual kernel group cap", () =>
    withGovernor(({ memory, root, group }) =>
      Effect.gen(function* () {
        NodeFS.writeFileSync(NodePath.join(root, "memory.max"), String(2 * GiB));
        group(1.5 * GiB);
        const waiting = yield* Deferred.make<void>();
        const start = yield* acquire(memory, "a", Deferred.succeed(waiting, undefined)).pipe(
          Effect.forkChild,
        );
        yield* Deferred.await(waiting);
        group(GiB);
        yield* TestClock.adjust("2 seconds");
        yield* yield* Fiber.join(start);
      }),
    ),
  );
});
