// @effect-diagnostics nodeBuiltinImport:off -- This adapter test binds a real local socket or Windows named pipe and verifies its cleanup.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  DEFAULT_CLIENT_SETTINGS,
  ProjectId,
  ThreadId,
  type DesktopAppActivationRequest,
  type DesktopAppActivationResponse,
} from "@t3tools/contracts";
import { resolveDesktopAppControlAddress } from "@t3tools/shared/desktopAppControl";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";

import { gateControlRequest, startDesktopAppControlServer } from "./DesktopAppActivation.ts";

const openServers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function makeTarget(stateDir: string, platform: NodeJS.Platform, userId: number | undefined) {
  return resolveDesktopAppControlAddress({
    stateDir,
    platform,
    tempDir: NodeOS.tmpdir(),
    userId,
    joinPath: NodePath.join,
  });
}

function request(requestId: string, platform: NodeJS.Platform): DesktopAppActivationRequest {
  return {
    version: 1,
    requestId,
    type: "open-workspace",
    workspaceRoot: NodePath.join(NodeOS.tmpdir(), "project"),
    platform: platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux",
  };
}

function startOkServer(target: ReturnType<typeof makeTarget>, userId: number | undefined) {
  return startDesktopAppControlServer({
    ...target,
    userId,
    handle: async (input) => ({
      version: 1,
      requestId: input.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    }),
    cancel: () => undefined,
    onReclaimError: () => undefined,
  }).then((server) => {
    openServers.push(server);
    return server;
  });
}

function exchange(address: string, payload: DesktopAppActivationRequest | object) {
  return new Promise<DesktopAppActivationResponse>((resolve, reject) => {
    const socket = NodeNet.createConnection(address);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.once("error", reject);
    socket.once("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      socket.destroy();
      resolve(JSON.parse(buffer.slice(0, newline)) as DesktopAppActivationResponse);
    });
  });
}

describe("desktop app control server", () => {
  it.effect("cancels a queued request when the client disconnects", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      const userId = yield* HostProcess.UserId;
      yield* Effect.promise(async () => {
        const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-app-cancel-test-"));
        const target = makeTarget(NodePath.join(root, "userdata"), platform, userId);
        let resolveCanceled: (requestId: string) => void = () => undefined;
        const canceled = new Promise<string>((resolve) => {
          resolveCanceled = resolve;
        });
        const server = await startDesktopAppControlServer({
          ...target,
          userId,
          handle: () => new Promise(() => undefined),
          cancel: resolveCanceled,
          onReclaimError: () => undefined,
        });
        openServers.push(server);
        const socket = NodeNet.createConnection(target.address);
        await new Promise<void>((resolve, reject) => {
          socket.once("error", reject);
          socket.once("connect", () => {
            socket.write(`${JSON.stringify(request("request-canceled", platform))}\n`, () => {
              socket.destroy();
              resolve();
            });
          });
        });

        await expect(canceled).resolves.toBe("request-canceled");
        await server.close();
        openServers.splice(openServers.indexOf(server), 1);
        await NodeFSP.rm(root, { recursive: true, force: true });
      });
    }),
  );

  it.effect("keeps a newer app's socket when an older app on the same state dir quits", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      const userId = yield* HostProcess.UserId;
      if (platform === "win32") return;
      yield* Effect.promise(async () => {
        const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-app-takeover-test-"));
        const target = makeTarget(NodePath.join(root, "userdata"), platform, userId);
        const older = await startOkServer(target, userId);
        await startOkServer(target, userId);

        await older.close();

        await expect(
          exchange(target.address, request("after-quit", platform)),
        ).resolves.toMatchObject({ ok: true, requestId: "after-quit" });
        await NodeFSP.rm(root, { recursive: true, force: true });
      });
    }),
  );

  it.effect("binds its address again after the socket file is removed", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      const userId = yield* HostProcess.UserId;
      if (platform === "win32") return;
      yield* Effect.promise(async () => {
        const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-app-reclaim-test-"));
        const target = makeTarget(NodePath.join(root, "userdata"), platform, userId);
        const server = await startOkServer(target, userId);

        await NodeFSP.unlink(target.address);
        await server.reclaim();

        await expect(
          exchange(target.address, request("reclaimed", platform)),
        ).resolves.toMatchObject({
          ok: true,
          requestId: "reclaimed",
        });
        await NodeFSP.rm(root, { recursive: true, force: true });
      });
    }),
  );
});

describe("app script gate", () => {
  const scriptRequest = (agentThreadId?: string): DesktopAppActivationRequest => ({
    version: 1,
    requestId: "script-1",
    type: "run-script",
    platform: "linux",
    script: { kind: "name", name: "open-inbox" },
    ...(agentThreadId === undefined ? {} : { agentThreadId }),
  });
  const forwarded: DesktopAppActivationRequest[] = [];
  const gate = (settings: Partial<typeof DEFAULT_CLIENT_SETTINGS> | null) =>
    gateControlRequest({
      readSettings: async () =>
        settings === null ? null : { ...DEFAULT_CLIENT_SETTINGS, ...settings },
      forward: async (input) => {
        forwarded.push(input);
        return { version: 1, requestId: input.requestId, ok: true, output: null };
      },
    });

  it.each([
    ["unreadable settings", null, undefined, false],
    ["default settings", {}, undefined, false],
    ["scripts on, terminal off", { appScriptsEnabled: true }, undefined, false],
    ["terminal on", { appScriptsEnabled: true, appScriptsFromTerminal: true }, undefined, true],
    [
      "terminal on, agent caller",
      { appScriptsEnabled: true, appScriptsFromTerminal: true },
      "thread-agent",
      false,
    ],
    [
      "agents allowed",
      { appScriptsEnabled: true, appScriptsFromTerminal: true, appScriptsFromAgents: true },
      "thread-agent",
      true,
    ],
  ] as const)("%s", async (_name, settings, agentThreadId, allowed) => {
    forwarded.length = 0;
    const response = await gate(settings)(scriptRequest(agentThreadId));
    expect(response.ok).toBe(allowed);
    expect(forwarded).toHaveLength(allowed ? 1 : 0);
    if (!allowed) expect(response).toMatchObject({ code: "scripts-disabled" });
  });

  it("always forwards opening a project", async () => {
    forwarded.length = 0;
    await gate({})(request("open-1", "linux"));
    expect(forwarded.map((input) => input.type)).toEqual(["open-workspace"]);
  });

  it.effect("rejects a script name that could leave the scripts folder before handling it", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      const userId = yield* HostProcess.UserId;
      yield* Effect.promise(async () => {
        const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-app-script-test-"));
        const target = makeTarget(NodePath.join(root, "userdata"), platform, userId);
        const handled: string[] = [];
        const server = await startDesktopAppControlServer({
          ...target,
          userId,
          handle: async (input) => {
            handled.push(input.requestId);
            return { version: 1, requestId: input.requestId, ok: true, output: null };
          },
          cancel: () => undefined,
          onReclaimError: () => undefined,
        });
        openServers.push(server);
        const traversal = {
          ...scriptRequest(),
          requestId: "traversal",
          script: { kind: "name", name: "../secrets" },
        };

        await expect(exchange(target.address, traversal)).resolves.toMatchObject({
          ok: false,
          code: "invalid-request",
        });
        await expect(
          exchange(target.address, { ...scriptRequest(), requestId: "valid" }),
        ).resolves.toMatchObject({ ok: true });
        expect(handled).toEqual(["valid"]);
        await NodeFSP.rm(root, { recursive: true, force: true });
      });
    }),
  );
});
