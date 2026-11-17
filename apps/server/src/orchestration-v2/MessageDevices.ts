import type { OrchestrationMessageSentFrom } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class MessageDevices extends Context.Service<
  MessageDevices,
  {
    readonly record: (device: OrchestrationMessageSentFrom | undefined) => Effect.Effect<void>;
    readonly list: Effect.Effect<ReadonlyArray<OrchestrationMessageSentFrom>>;
  }
>()("t3/orchestration-v2/MessageDevices") {}

export const layer = Layer.effect(
  MessageDevices,
  Effect.gen(function* () {
    const known = yield* Ref.make<ReadonlyArray<OrchestrationMessageSentFrom>>([]);
    return MessageDevices.of({
      record: Effect.fn("MessageDevices.record")(function* (device) {
        if (!device) return;
        yield* Ref.update(known, (devices) =>
          devices.some((entry) => JSON.stringify(entry) === JSON.stringify(device))
            ? devices
            : [...devices, device],
        );
      }),
      list: Ref.get(known),
    });
  }),
);
