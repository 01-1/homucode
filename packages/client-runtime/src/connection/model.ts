import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { RelayEnvironmentEndpointFailure } from "@t3tools/contracts/relay";
import * as Schema from "effect/Schema";

const ConnectionTargetBase = {
  environmentId: EnvironmentId,
  label: Schema.String,
};

export class PrimaryConnectionTarget extends Schema.TaggedClass<PrimaryConnectionTarget>()(
  "PrimaryConnectionTarget",
  {
    ...ConnectionTargetBase,
    httpBaseUrl: Schema.String,
    wsBaseUrl: Schema.String,
  },
) {}

export class BearerConnectionTarget extends Schema.TaggedClass<BearerConnectionTarget>()(
  "BearerConnectionTarget",
  {
    ...ConnectionTargetBase,
    connectionId: Schema.String,
  },
) {}

export class RelayConnectionTarget extends Schema.TaggedClass<RelayConnectionTarget>()(
  "RelayConnectionTarget",
  {
    ...ConnectionTargetBase,
  },
) {}

export class SshConnectionTarget extends Schema.TaggedClass<SshConnectionTarget>()(
  "SshConnectionTarget",
  {
    ...ConnectionTargetBase,
    connectionId: Schema.String,
  },
) {}

export const ConnectionTarget = Schema.Union([
  PrimaryConnectionTarget,
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
]);
export type ConnectionTarget = typeof ConnectionTarget.Type;

export const PersistedConnectionTarget = Schema.Union([
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
]);
export type PersistedConnectionTarget = typeof PersistedConnectionTarget.Type;

export type NetworkStatus = "unknown" | "offline" | "online";

export const ConnectionTransientReason = Schema.Literals([
  "network",
  "timeout",
  "transport",
  "endpoint-unavailable",
  "relay-unavailable",
  "remote-unavailable",
  "session-pending",
  "approval-pending",
]);
export type ConnectionTransientReason = typeof ConnectionTransientReason.Type;

export const ConnectionBlockedReason = Schema.Literals([
  "authentication",
  "configuration",
  "permission",
  "unsupported",
]);
export type ConnectionBlockedReason = typeof ConnectionBlockedReason.Type;

/** A part of the path to an environment: this device, T3 Connect, the host's tunnel, or T3 Code on the host. */
export const ConnectionHop = Schema.Literals(["device", "relay", "tunnel", "server"]);
export type ConnectionHop = typeof ConnectionHop.Type;

/** The relay's endpoint failures plus the causes the client can name from other errors. */
export const ConnectionFailureCause = Schema.Literals([
  ...RelayEnvironmentEndpointFailure.literals,
  "clock_skew",
  "not_linked",
  "relay_error",
  "tunnel_pending",
  "tunnel_not_enabled",
  "approval_pending",
  "signed_out",
