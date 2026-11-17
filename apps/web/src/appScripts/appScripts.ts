import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  appScriptRunRefusal,
  type AppScriptRunSource,
  DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
  type DesktopAppActivationResponse,
  type DesktopAppRunScriptRequest,
} from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { toastManager } from "~/components/ui/toast";
import { isElectron } from "../env";
import { getClientSettings } from "../hooks/useSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { registerCommands, resolveKeyDownCommand } from "../shortcuts/dispatcher";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { serverEnvironment } from "../state/server";
import { createAppScriptApi, type T3App } from "./appScriptApi";
import { appScriptNameFromCommand, appScriptOutput, isLocalAppWindow } from "./appScripts.logic";

class AppScriptRefusedError extends Error {}

let api: T3App | null = null;

async function loadNamedScript(name: string): Promise<string> {
  const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  if (environmentId === null) throw new Error("This window has no local environment connected.");
  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.loadAppScript,
    { environmentId, input: { name } },
    { reportFailure: false },
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value.code;
}

/** Checks this device's gates, then runs the script's default export with the `t3` API. */
async function runAppScript(input: {
  readonly script:
    | { readonly kind: "name"; readonly name: string }
    | { readonly kind: "code"; readonly code: string };
  readonly source: AppScriptRunSource;
  readonly fromAgent: boolean;
}): Promise<string | null> {
  const refusal = appScriptRunRefusal(getClientSettings(), input);
  if (refusal !== null) throw new AppScriptRefusedError(refusal);
  if (!isLocalAppWindow({ electron: isElectron, hostname: window.location.hostname })) {
    throw new AppScriptRefusedError(
      "App scripts run only in the desktop app or in a browser on the same machine as T3 Code.",
    );
  }
  if (api === null) throw new Error("T3 Code is still starting.");
  const code =
    input.script.kind === "name" ? await loadNamedScript(input.script.name) : input.script.code;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  let module: { readonly default?: unknown };
  try {
    module = await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (typeof module.default !== "function") {
    throw new Error("An app script must `export default` a function that takes `t3`.");
  }
  return appScriptOutput(await module.default(api));
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error);
}

/** Answers a `t3 app run` request that the desktop app already let through its own gate. */
export async function handleRunScriptRequest(
  request: DesktopAppRunScriptRequest,
): Promise<DesktopAppActivationResponse> {
  const base = { version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION, requestId: request.requestId };
  try {
    const output = await runAppScript({
      script: request.script,
      source: "terminal",
      fromAgent: request.agentThreadId !== undefined,
    });
    return { ...base, ok: true, output };
  } catch (error) {
    return {
      ...base,
      ok: false,
      code: error instanceof AppScriptRefusedError ? "scripts-disabled" : "script-failed",
      message: errorMessage(error) || "The app script failed.",
    };
  }
}

/** Runs `user.<name>.run` keybindings. Capture phase, so a focused terminal cannot swallow them. */
export function installAppScripts(router: AnyRouter): () => void {
  api = createAppScriptApi(router);
  return registerCommands(
    {},
    {
      capture: true,
      onKeyDown: (event) => {
        const command = resolveKeyDownCommand(event);
        const name = command === null ? null : appScriptNameFromCommand(command);
        if (name === null) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        void runAppScript({
          script: { kind: "name", name },
          source: "keybinding",
          fromAgent: false,
        }).catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: `App script ${name} failed`,
            description: errorMessage(error),
          });
        });
      },
    },
  );
}
