import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const secureStore = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: vi.fn((key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  }),
}));

import { appAtomRegistry } from "../../state/atom-registry";
import {
  activateCloudRelayAccount,
  cloudAccountService,
  deactivateCloudRelayAccount,
  restoreLastCloudAccount,
} from "./cloudAccountService";
import { setAgentAwarenessRelayTokenProvider } from "../agent-awareness/remoteRegistration";
import { requestConnectOnboarding } from "./connectOnboarding";
import { restoreCloudComposerDrafts } from "../../state/use-composer-drafts";

vi.mock("@clerk/expo", () => ({
  ClerkProvider: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("@clerk/expo/token-cache", () => ({
  tokenCache: {},
}));

vi.mock("../../lib/runtime", () => ({
  runtime: {
    runPromiseExit: vi.fn(),
  },
}));

vi.mock("../../connection/catalog", () => ({
  environmentCatalog: {
    removeRelayEnvironments: {},
  },
}));

vi.mock("./cloud-drafts", () => ({ removeCloudEnvironments: {} }));
vi.mock("./connectOnboarding", () => ({
  clearConnectOnboardingRequest: vi.fn(),
  requestConnectOnboarding: vi.fn(),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerCloudAccountId: vi.fn(async () => null),
  restoreCloudComposerDrafts: vi.fn(async () => undefined),
}));

vi.mock("./publicConfig", () => ({
  resolveCloudPublicConfig: vi.fn(() => ({
    clerk: { publishableKey: null },
    relay: { url: null },
  })),
  resolveRelayClerkTokenOptions: vi.fn(),
}));

vi.mock("../agent-awareness/remoteRegistration", () => ({
  releaseAgentAwarenessRelayTokenProvider: vi.fn(),
  setAgentAwarenessRelayTokenProvider: vi.fn(),
  unregisterAgentAwarenessDeviceForCurrentUser: vi.fn(),
}));

type ClerkListener = (resources: { readonly user: { readonly id: string } | null }) => void;

function fakeClerk() {
  const listeners = new Set<ClerkListener>();
  let loaded = false;
  let user: { readonly id: string } | null = null;
  const clerk = {
    get loaded() {
      return loaded;
    },
    get user() {
      return user;
    },
    session: { getToken: vi.fn(async () => "clerk-token") },
    addListener: (listener: ClerkListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as Parameters<typeof cloudAccountService.attach>[0];
  const emit = (userId: string | null) => {
    loaded = true;
    user = userId === null ? null : { id: userId };
    for (const listener of listeners) listener({ user });
  };
  return { clerk, emit };
}

afterEach(() => {
  deactivateCloudRelayAccount();
  secureStore.clear();
  vi.clearAllMocks();
});

describe("CloudAuthProvider relay account isolation", () => {
  it("clears relay and agent-awareness credentials before cleanup can fail", async () => {
    const tokenProvider = async () => "account-1-token";
    activateCloudRelayAccount("account-1", tokenProvider);
    expect(appAtomRegistry.get(managedRelaySessionAtom)?.accountId).toBe("account-1");

    deactivateCloudRelayAccount();
    const cleanup = Promise.reject(new Error("Persistence removal failed.")).catch(() => undefined);

    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();
    expect(vi.mocked(setAgentAwarenessRelayTokenProvider)).toHaveBeenLastCalledWith(null);
    await cleanup;
  });
});

describe("cloudAccountService", () => {
  it("activates the signed-in account once its drafts are restored", async () => {
    const { clerk, emit } = fakeClerk();
    using _detach = { [Symbol.dispose]: cloudAccountService.attach(clerk) };

    emit("account-1");
    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();

    await vi.waitFor(() =>
      expect(appAtomRegistry.get(managedRelaySessionAtom)?.accountId).toBe("account-1"),
    );
    expect(vi.mocked(restoreCloudComposerDrafts)).toHaveBeenCalledWith("account-1");
    // Clerk already had this account on its first emission, so this is not a fresh sign-in.
    expect(vi.mocked(requestConnectOnboarding)).not.toHaveBeenCalled();
  });

  it("retries an activation whose draft restore failed on the next emission", async () => {
    const { clerk, emit } = fakeClerk();
    using _detach = { [Symbol.dispose]: cloudAccountService.attach(clerk) };
    vi.mocked(restoreCloudComposerDrafts).mockRejectedValueOnce(new Error("Storage busy."));

    emit("account-1");
    await vi.waitFor(() => expect(cloudAccountService.getState()._tag).toBe("Failed"));
    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();

    emit("account-1");
    await vi.waitFor(() =>
      expect(appAtomRegistry.get(managedRelaySessionAtom)?.accountId).toBe("account-1"),
    );
  });
});

describe("restoreLastCloudAccount", () => {
  async function launchWithStoredAccount(storedAccountId: string) {
    activateCloudRelayAccount(storedAccountId, async () => null);
    await vi.waitFor(() => expect(secureStore.size).toBe(1));
    deactivateCloudRelayAccount({ signedOut: false });
    const launch = fakeClerk();
    const detach = cloudAccountService.attach(launch.clerk);
    await restoreLastCloudAccount(launch.clerk);
    return { ...launch, [Symbol.dispose]: detach };
  }

  it("connects as the last account before Clerk loads, reading tokens only once it has", async () => {
    using launch = await launchWithStoredAccount("account-1");

    const session = appAtomRegistry.get(managedRelaySessionAtom);
    expect(session?.accountId).toBe("account-1");
    const readToken = vi.mocked(setAgentAwarenessRelayTokenProvider).mock.lastCall?.[0];
    const token = readToken!();
    expect(launch.clerk.session!.getToken).not.toHaveBeenCalled();

    launch.emit("account-1");
    await expect(token).resolves.toBe("clerk-token");
    await vi.waitFor(() => expect(cloudAccountService.getState()._tag).toBe("Active"));
    // The same account keeps its session, so live connections are not replaced.
    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBe(session);
  });

  it("drops the restored account when Clerk loads signed out", async () => {
    using launch = await launchWithStoredAccount("account-1");

    launch.emit(null);

    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();
    await vi.waitFor(() => expect(secureStore.size).toBe(0));
  });

  it("drops the restored account at once when Clerk loads another account", async () => {
    using launch = await launchWithStoredAccount("account-1");
    const readToken = vi.mocked(setAgentAwarenessRelayTokenProvider).mock.lastCall?.[0];
    const token = readToken!();

    launch.emit("account-2");

    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();
    // A read started for the restored account never returns the other account's token.
    await expect(token).resolves.toBeNull();
    await vi.waitFor(() =>
      expect(appAtomRegistry.get(managedRelaySessionAtom)?.accountId).toBe("account-2"),
    );
  });

  it("leaves an account Clerk already reported alone", async () => {
    activateCloudRelayAccount("account-1", async () => null);
    await vi.waitFor(() => expect(secureStore.size).toBe(1));
    deactivateCloudRelayAccount({ signedOut: false });
    const { clerk, emit } = fakeClerk();
    using _detach = { [Symbol.dispose]: cloudAccountService.attach(clerk) };
    emit("account-2");

    await restoreLastCloudAccount(clerk);

    expect(appAtomRegistry.get(managedRelaySessionAtom)?.accountId).not.toBe("account-1");
  });
});
