import {
  AuthOrchestrationReadScope,
  ORCHESTRATION_PROTOCOL_VERSION,
  ProviderInstanceId,
  WS_METHODS,
  WsServerRefreshProvidersRpc,
} from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/cli";
import * as CliError from "effect/cli/CliError";
import { RpcClient, RpcGroup, RpcSerialization } from "effect/rpc";
import * as Socket from "effect/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readLiveServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const encodeJson = Schema.encodeSync(fromJsonStringPretty(Schema.Unknown));

const refreshCommand = Command.make("refresh", {
  ...projectLocationFlags,
  provider: Flag.String("provider").pipe(
    Flag.withSchema(ProviderInstanceId),
    Flag.withDescription("Refresh one provider instance instead of all providers."),
    Flag.optional,
  ),
  json: Flag.Boolean("json").pipe(Flag.withDescription("Print refreshed providers as JSON.")),
}).pipe(
  Command.withDescription("Refetch provider status and models from the running server."),
  Command.withHandler(
    Effect.fn("cli.provider.refresh")(function* (flags) {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
        quietLogs: flags.json,
      });
      const minimumLogLevel = flags.json ? "Error" : config.logLevel;
      const state = yield* readLiveServerRuntimeState(config.serverRuntimeStatePath);
      if (Option.isNone(state)) {
        return yield* new CliError.UserError({
          cause: config.baseDir,
          userMessage: `No running T3 Code server uses ${config.baseDir}. Start T3 Code, then retry.`,
        });
      }
      const origin = state.value.origin;
      const instanceId = Option.getOrUndefined(flags.provider);
      const result = yield* Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* Effect.acquireRelease(
          auth.issueSession({ label: "t3-provider-cli", scopes: [AuthOrchestrationReadScope] }),
          ({ sessionId }) => auth.revokeSession(sessionId).pipe(Effect.ignore({ log: true })),
        );
        const ticket = yield* auth.issueWebSocketTicket(session, { use: "rpc" });
        const url = new URL("/ws", origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
        url.searchParams.set("wsTicket", Redacted.value(ticket.ticket));
        const protocol = yield* Layer.build(
          RpcClient.layerProtocolSocket().pipe(
            Layer.provide(RpcSerialization.layerJson),
            Layer.provide(
              Socket.layerWebSocket(url.href).pipe(
                Layer.provide(Socket.layerWebSocketConstructorGlobal),
              ),
            ),
          ),
        );
        const client = yield* RpcClient.make(RpcGroup.make(WsServerRefreshProvidersRpc)).pipe(
          Effect.provideContext(protocol),
        );
        return yield* client[WS_METHODS.serverRefreshProviders]({
          ...(instanceId === undefined ? {} : { instanceId }),
          refreshModels: true,
          reloadSecrets: true,
        });
      }).pipe(
        Effect.scoped,
        Effect.provideService(References.MinimumLogLevel, minimumLogLevel),
        Effect.provide(
          EnvironmentAuth.layerRuntime.pipe(
            Layer.provide(ServerConfig.layer(config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
          ),
        ),
      );
      const providers = result.providers.filter(
        (provider) => instanceId === undefined || provider.instanceId === instanceId,
      );
      if (instanceId !== undefined && providers.length === 0) {
        return yield* new CliError.UserError({
          cause: instanceId,
          userMessage: `No provider instance named ${instanceId}.`,
        });
      }
      yield* Console.log(
        flags.json
          ? encodeJson({ providers })
          : providers
              .map(
                (provider) =>
                  `${provider.instanceId}: ${provider.models.length} models (${provider.status})`,
              )
              .join("\n"),
      );
    }),
  ),
);

export const providerCommand = Command.make("provider").pipe(
  Command.withDescription("Manage providers on the running server."),
  Command.withSubcommands([refreshCommand]),
);
