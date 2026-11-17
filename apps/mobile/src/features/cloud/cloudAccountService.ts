import type { getClerkInstance } from "@clerk/expo";
import {
  createCloudAccountService,
  ManagedRelay,
  setManagedRelaySession,
} from "@t3tools/client-runtime/relay";
import {
  reportAtomCommandResult,
  runAtomCommand,
  settleAsyncResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as SecureStore from "expo-secure-store";

import { clearLaunchSnapshot } from "../../lib/launchSnapshot";
import { runtime } from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  getComposerCloudAccountId,
  restoreCloudComposerDrafts,
} from "../../state/use-composer-drafts";
import {
  releaseAgentAwarenessRelayTokenProvider,
  setAgentAwarenessRelayTokenProvider,
  unregisterAgentAwarenessDeviceForCurrentUser,
} from "../agent-awareness/remoteRegistration";
import { removeCloudEnvironments } from "./cloud-drafts";
import { clearConnectOnboardingRequest, requestConnectOnboarding } from "./connectOnboarding";
import { resolveRelayClerkTokenOptions } from "./publicConfig";

type ClerkInstance = ReturnType<typeof getClerkInstance>;

const LAST_CLOUD_ACCOUNT_KEY = "t3code.cloud.last-active-account";

export function deactivateCloudRelayAccount(input?: { readonly signedOut: boolean }): void {
  setAgentAwarenessRelayTokenProvider(null);
  setManagedRelaySession(appAtomRegistry, null, input);
  if (input?.signedOut) void SecureStore.deleteItemAsync(LAST_CLOUD_ACCOUNT_KEY).catch(() => {});
}

export function activateCloudRelayAccount(
  accountId: string,
  tokenProvider: () => Promise<string | null>,
): void {
  setAgentAwarenessRelayTokenProvider(tokenProvider, accountId);
  setManagedRelaySession(appAtomRegistry, {
    accountId,
    readClerkToken: tokenProvider,
  });
  void SecureStore.setItemAsync(LAST_CLOUD_ACCOUNT_KEY, accountId).catch(() => {});
}

function onClerkLoad(clerk: ClerkInstance, run: (user: { readonly id: string } | null) => void) {
  let unsubscribe: (() => void) | undefined;
  let settled = false;
  unsubscribe = clerk.addListener(({ user }) => {
    if (user === undefined || settled) return;
    settled = true;
    queueMicrotask(() => unsubscribe?.());
    run(user);
  });
}

/**
 * Clerk fetches its client over the network on every launch before it reports
 * the signed-in user. Until then the last account lets connections use their
 * cached environment credentials; a Clerk token waits for Clerk.
 */
export async function restoreLastCloudAccount(
  clerk: ClerkInstance,
  enabled = false,
): Promise<void> {
  if (!enabled) return;
  const accountId = await SecureStore.getItemAsync(LAST_CLOUD_ACCOUNT_KEY).catch(() => null);
  if (accountId === null || cloudAccountService.getState()._tag !== "Unobserved") return;
  const loaded = new Promise<void>((resolve) =>
    onClerkLoad(clerk, (user) => {
      if (user?.id !== accountId) deactivateCloudRelayAccount({ signedOut: user === null });
      resolve();
    }),
  );
  const readToken = clerkTokenReader(clerk);
  const isRestoredAccount = () => clerk.user?.id === accountId;
  activateCloudRelayAccount(accountId, async () => {
    if (!clerk.loaded) await loaded;
    if (!isRestoredAccount()) return null;
    const token = await readToken();
    return isRestoredAccount() ? token : null;
  });
}

function clerkTokenReader(clerk: ClerkInstance): () => Promise<string | null> {
  return async () =>
    clerk.session ? await clerk.session.getToken(resolveRelayClerkTokenOptions()) : null;
}

const cleanUpCloudAccount = async (
  clerk: ClerkInstance,
  accountId: string | null,
  wasActive: boolean,
) => {
  const removal = await runAtomCommand(appAtomRegistry, removeCloudEnvironments, accountId, {
    reportFailure: false,
    reportDefect: false,
  });
  if (removal._tag !== "Success") throw squashAtomCommandFailure(removal);
  const results = await Promise.all([
    settleAsyncResult(() =>
      runtime.runPromiseExit(
        ManagedRelay.ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
      ),
    ),
    ...(wasActive
      ? [
          settleAsyncResult(() =>
            runtime.runPromiseExit(
              unregisterAgentAwarenessDeviceForCurrentUser(clerkTokenReader(clerk)),
            ),
          ),
        ]
      : []),
  ]);
  for (const result of results) {
    reportAtomCommandResult(result, { label: "cloud account cleanup" });
  }
};

export const cloudAccountService = createCloudAccountService<ClerkInstance>({
  deactivate: deactivateCloudRelayAccount,
  // Detaching is not a sign-out: the user is usually still signed in, so keep
  // lock-screen activities and the persisted registration for the next attach.
  detach: () => {
    releaseAgentAwarenessRelayTokenProvider();
    setManagedRelaySession(appAtomRegistry, null);
  },
  // A not-yet-presented onboarding request and the launch picture belong to the account that left.
  onSignOutTransition: () => {
    clearConnectOnboardingRequest();
    clearLaunchSnapshot();
  },
  cleanUp: ({ source, accountId, wasActive }) => cleanUpCloudAccount(source, accountId, wasActive),
  prepare: async ({ source, accountId, isCurrent }) => {
    const storedAccount = await getComposerCloudAccountId();
    if (storedAccount !== null && storedAccount !== accountId) {
      await cleanUpCloudAccount(source, storedAccount, false);
    }
    if (!isCurrent()) return;
    await restoreCloudComposerDrafts(accountId);
  },
  activate: ({ source, accountId, isAccountTransition }) => {
    activateCloudRelayAccount(accountId, clerkTokenReader(source));
    // Issued after cleanup so the sheet never lists the previous account's environments.
    if (isAccountTransition) requestConnectOnboarding(accountId);
  },
});
