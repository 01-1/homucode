import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeWS from "@effect/platform-node/NodeWS";
import { assert, it } from "@effect/vitest";
import { ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";

import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import { providerCommand } from "./provider.ts";

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer))(
  "provider CLI",
  (it) => {
    it.live("refreshes all or one provider through the running server's authenticated RPC", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-cli-" });
        const requests: unknown[] = [];
        const output: string[] = [];
        const provider = {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          version: "0.169.0",
          status: "ready",
          auth: { status: "unknown" },
          checkedAt: "2026-11-17T18:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        };
        const server = yield* Effect.acquireRelease(
          Effect.sync(() => new NodeWS.WebSocketServer({ port: 0, host: "127.0.0.1" })),
          (server) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  for (const client of server.clients) client.terminate();
                  server.close(() => resolve());
                }),
            ),
        );
        if (!server.address()) {
          yield* Effect.promise(
            () => new Promise<void>((resolve) => server.once("listening", resolve)),
          );
        }
        const address = server.address();
        assert(address !== null && typeof address !== "string");
        server.on("connection", (socket, request) => {
          const url = new URL(request.url!, "http://localhost");
          assert.strictEqual(
            url.searchParams.get("orchestrationProtocol"),
            String(ORCHESTRATION_PROTOCOL_VERSION),
          );
          assert.isTrue(Boolean(url.searchParams.get("wsTicket")));
          socket.on("message", (data) => {
            const frame = JSON.parse(String(data));
            if (frame._tag !== "Request") return;
            requests.push({ tag: frame.tag, payload: frame.payload });
            socket.send(
              JSON.stringify({
                _tag: "Exit",
                requestId: frame.id,
                exit: { _tag: "Success", value: { providers: [provider] } },
              }),
            );
          });
        });
        yield* persistServerRuntimeState({
          path: `${root}/userdata/server-runtime.json`,
          state: yield* makePersistedServerRuntimeState({
            config: { host: "127.0.0.1", devUrl: undefined },
            port: address.port,
          }),
        });
        for (const options of [[], ["--provider", "codex"]]) {
          yield* Command.runWith(providerCommand, { version: "0.0.0" })([
            "refresh",
            "--base-dir",
            root,
            "--json",
            ...options,
          ]).pipe(
            Effect.updateService(Console.Console, (console) => ({
              ...console,
              log: (...args) => Effect.sync(() => output.push(args.join(" "))),
            })),
          );
        }
        assert.deepStrictEqual(requests, [
          {
            tag: "server.refreshProviders",
            payload: { refreshModels: true, reloadSecrets: true },
          },
          {
            tag: "server.refreshProviders",
            payload: { instanceId: "codex", refreshModels: true, reloadSecrets: true },
          },
        ]);
        assert.deepStrictEqual(
          output.map((line) => JSON.parse(line)),
          [{ providers: [provider] }, { providers: [provider] }],
        );
      }),
    );
  },
);
