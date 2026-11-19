import { installPermissionUpdateNotice } from "./features/connection/permissionUpdateNotice";
import { installComposerAttachmentUploads } from "./state/composer-attachment-uploads";
import { installThreadOutboxDelivery } from "./state/threadOutboxDelivery";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { requireNativeModule } from "expo";
import { useEffect, useRef, useState } from "react";
import { Platform, StatusBar, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  CommonActions,
  createPathConfigForStaticNavigation,
  createStaticNavigation,
  getActionFromState,
  getStateFromPath,
  type NavigationAction,
  type NavigationContainerRef,
  type NavigationState,
} from "@react-navigation/native";
import { pipe } from "effect/Function";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { ProjectChipIconRasterizer } from "./native/ProjectChipIconImages";
import { ThreadArrangementHost } from "./features/threads/ThreadArrangementSheet";
import * as Dialog from "./components/ui/Dialog";
import { CloudAuthProvider } from "./features/cloud/CloudAuthProvider";
import { prepareNativeShowcaseCapture } from "./features/showcase/nativeShowcaseScene";
import { installShowcaseCapture } from "./features/showcase/ShowcaseCaptureCoordinator";
import {
  presentPendingIncomingShare,
  pruneIncomingShareImports,
  startIncomingShareInbox,
} from "./features/sharing/IncomingShareProvider";
import {
  installAgentNotificationNavigation,
  setAgentNotificationPathname,
} from "./features/agent-awareness/notificationNavigation";
import {
  installAppShortcuts,
  recordAppShortcutNavigationState,
} from "./features/shortcuts/appShortcutsRuntime";
import {
  AppearancePreferencesProvider,
  installAppearanceRuntime,
  useAppearancePreferences,
} from "./features/settings/appearance/AppearancePreferencesProvider";
import { RootStack, rootPathnameFromState, workspaceLocationFromState } from "./Stack";
import { appAtomRegistry } from "./state/atom-registry";
import { subscribeComposerDraftModelReconciliation } from "./state/use-composer-drafts";
import { environmentThreadShells, threadEnvironment } from "./state/threads";
import { environmentShell, shellCachesReadAtom } from "./state/shell";
import { OverlayPortalHost } from "./components/ui/OverlayPortal";
import { shouldHandleAppLink, restoreDraftLinkState } from "./lib/appLinking";
import { hasCloudPublicConfig } from "./features/cloud/publicConfig";
import { takeScheduledTaskNewLink } from "./features/settings/scheduled-task-editor-state";
import {
  pairingFormLinkAction,
  startDevAutoConnect,
  withoutPairingTarget,
} from "./features/connection/devAutoConnect";
import {
  resolvePendingNewTaskPromptLink,
  takeNewTaskPromptLink,
} from "./features/prompt-links/newTaskPromptLink";
import {
  resolvePendingThreadPromptLink,
  takeThreadPromptLink,
} from "./features/prompt-links/threadPromptLink";
import {
  disposeOnFoundationReplace,
  type FoundationHotModule,
} from "./lib/foundation-fast-refresh";
import { useMobileNavigationTheme } from "./lib/useMobileNavigationTheme";
import { installUiRuntimeMemoryWarningGc } from "./lib/useUiRuntimeMemoryWarningGc";
import { SubscriptionUsageCoordinator } from "./widgets/SubscriptionUsageCoordinator";
import { ConnectDeviceApprovalCoordinator } from "./features/connection/ConnectDeviceApprovalCoordinator";
import { installSubscriptionUsageRefresh } from "./widgets/useSubscriptionUsage";
import { GlobalVoiceInputControl } from "./features/voice-input/GlobalVoiceInputControl";
import {
  launchSplashHomeRowsPending,
  launchSplashWaitEndedAtom,
  settleLaunchSplashHomeRows,
  splashCanHide,
  useLaunchSplashHomeRowsPending,
} from "./features/home/home-launch-splash";
import {
  handOverLaunchSnapshot,
  installLaunchSnapshotCapture,
} from "./features/home/launchSnapshotRuntime";
import {
  restoreSettingsLinkState,
  settingsLinkAction,
} from "./features/settings/settings-navigation";
import {
  hydrateWorkspaceSelections,
  launchWorkspaceURL,
  recordWorkspaceSelections,
  settingsLinkPage,
} from "./features/layout/workspace/workspace-selection-store";
import { workspaceDetailLinkAction } from "./features/layout/workspace/workspace-detail-selection";
import { NativeLayoutMetricsProvider } from "./native/native-layout-metrics";
import { flushRootNavigationQueue, linkToRootPath, rootNavigationRef } from "./lib/rootNavigation";
import { pruneNewTaskFlowStates } from "./features/threads/new-task-flow-state";
import { pruneNewTaskBranchCheckouts } from "./features/threads/NewTaskDraftRouteScreen";
import { installAppUpdateChecks } from "./features/updates/app-updates";
import { installClientSettingsSync } from "./features/settings/settingsSync";
import {
  attachMadoHomuNavigation,
  attachMainNavigation,
  hasAndroidTaskRouting,
  MadoHomuLauncherSync,
  syncMadoHomuLauncherDestination,
  taskNavigationState,
  useMadoHomuEnvironmentStates,
} from "./features/madohomu/madohomuLauncher";
import {
  MADOHOMU_LAUNCH_SURFACE,
  madohomuLauncherWanted,
} from "./features/madohomu/madohomuLauncherState";
import { useMadoHomuEnvironments } from "./features/madohomu/MadoHomuEntries";
import { AndroidTaskSurfaceContext } from "./lib/backHandler";
import { holdTouches, touchesHeld } from "./lib/strayTouchGuard";

import "../global.css";

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  prepareNativeShowcaseCapture();
}

void SplashScreen.preventAutoHideAsync().catch(() => {});
void hydrateWorkspaceSelections();

const linkingConfig = {
  initialRouteName: "Home",
  screens: createPathConfigForStaticNavigation(RootStack, { initialRouteName: "Home" }) ?? {},
} as const;

function getAppStateFromPath(path: string, options: Parameters<typeof getStateFromPath>[1]) {
  return pipe(
    getStateFromPath(path, options),
    (state) => restoreDraftLinkState(state, path),
    (state) => restoreSettingsLinkState(state, settingsLinkPage()),
    takeThreadPromptLink,
    takeNewTaskPromptLink,
    withoutPairingTarget,
    startDevAutoConnect,
    takeScheduledTaskNewLink,
  );
}

const appLinking = {
  prefixes: [
    Linking.createURL("/"),
    "t3code://",
    "t3code-dev://",
    "t3code-preview://",
    DEFAULT_HOSTED_APP_URL,
  ],
  config: { initialRouteName: "Home" },
  filter: (url: string) => shouldHandleAppLink(url, hasCloudPublicConfig()),
  getInitialURL: async () => (await Linking.getInitialURL()) ?? (await launchWorkspaceURL()),
  getActionFromState: (
    state: Parameters<typeof getActionFromState>[0],
    options: Parameters<typeof getActionFromState>[1],
  ): ReturnType<typeof getActionFromState> => {
    const current = rootNavigationRef.isReady() ? rootNavigationRef.getRootState() : undefined;
    return (
      // Our router handles the selection; React Navigation's type only lists its own actions.
      (workspaceDetailLinkAction(state) as ReturnType<typeof getActionFromState>) ??
      pairingFormLinkAction(state, current) ??
      settingsLinkAction(state, current) ??
      getActionFromState(state, options)
    );
  },
  getStateFromPath: getAppStateFromPath,
};

function appLinkAction(href: string): NavigationAction {
  const state = getAppStateFromPath(href, linkingConfig);
  if (!state) throw new Error(`Failed to parse the href to a navigation state (${href}).`);
  return appLinking.getActionFromState(state, linkingConfig) ?? CommonActions.reset(state);
}

function linkToAppPath(href: string): void {
  linkToRootPath(href, appLinkAction);
}

const Navigation = createStaticNavigation(RootStack);

function handleNavigationStateChange(state: NavigationState | undefined): void {
  recordWorkspaceSelections(state);
  presentPendingIncomingShare();
  resolvePendingNewTaskPromptLink(state);
  resolvePendingThreadPromptLink(state);
  if (!state) return;
  // A launch that opens another route has no Home rows for the splash to wait for.
  if (state.routes[state.index]?.name !== "Home") settleLaunchSplashHomeRows();
  setAgentNotificationPathname(workspaceLocationFromState(state).pathname);
  recordAppShortcutNavigationState(state);
  pruneMountedDrafts(state, taskNavigationState("madohomu"));
}

function handleNavigationReady(): void {
  handleNavigationStateChange(taskNavigationState("main"));
  flushRootNavigationQueue();
}

function pruneMountedDrafts(
  mainState = taskNavigationState("main"),
  launcherState = taskNavigationState("madohomu"),
) {
  const state = { routes: [...(mainState?.routes ?? []), ...(launcherState?.routes ?? [])] };
  pruneNewTaskFlowStates(state);
  pruneNewTaskBranchCheckouts(state);
  pruneIncomingShareImports(state);
}

function withDraftCleanup(attach: typeof attachMainNavigation) {
  return (navigation: NavigationContainerRef<ReactNavigation.RootParamList> | null) => {
    const detach = attach(navigation);
    return () => {
      detach();
      // The replacement root can attach during the same commit.
      queueMicrotask(() => pruneMountedDrafts());
    };
  };
}

const attachMainRoot = withDraftCleanup(attachMainNavigation);
const attachLauncherRoot = withDraftCleanup(attachMadoHomuNavigation);

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const appServiceDisposers = [
  installUiRuntimeMemoryWarningGc(),
  subscribeComposerDraftModelReconciliation({
    registry: appAtomRegistry,
    threadShellAtom: environmentThreadShells.threadShellAtom,
    threadRefsAtom: environmentThreadShells.threadRefsAtom,
    shellStateAtom: environmentShell.stateAtom,
    pendingThreadIdsAtom: threadEnvironment.pendingThreadIdsAtom,
  }),
  installAppearanceRuntime(),
  installSubscriptionUsageRefresh(),
  installPermissionUpdateNotice(),
  installThreadOutboxDelivery(),
  installComposerAttachmentUploads(),
  startIncomingShareInbox(),
  installAgentNotificationNavigation(linkToAppPath),
  installAppShortcuts(linkToAppPath),
  installAppUpdateChecks(),
  installShowcaseCapture(rootPathnameFromState),
  installClientSettingsSync(() => linkToAppPath("/sync-conflicts")),
  installLaunchSnapshotCapture(),
];
disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () => {
  for (const dispose of appServiceDisposers) dispose();
});

// Cached shells are local reads that end in a fraction of this time; the limit keeps a failed
// read, or a list that does not lay out, from holding the splash screen.
const SPLASH_WAIT_MS = 1_500;

function SplashScreenCoordinator() {
  const { isReady } = useAppearancePreferences();
  const shellCachesRead = useAtomValue(shellCachesReadAtom);
  const homeRowsPending = useLaunchSplashHomeRowsPending();
  const waitEnded = useAtomValue(launchSplashWaitEndedAtom);
  const hidden = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the limit on how long the native splash screen waits for cached shells and their rows
  useEffect(() => {
    const timer = setTimeout(
      () => appAtomRegistry.set(launchSplashWaitEndedAtom, true),
      SPLASH_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hides the native splash screen once preferences have loaded and the cached rows are laid out
  useEffect(() => {
    const canHide = splashCanHide({
      preferencesReady: isReady,
      shellCachesRead,
      // Home holds the splash in a layout effect of the commit that gives it rows. That can be
      // this commit, after this render read the store.
      homeRowsPending: homeRowsPending || launchSplashHomeRowsPending(),
      waitEnded,
    });
    if (!canHide || hidden.current) return;
    hidden.current = true;
    settleLaunchSplashHomeRows();
    holdTouches();
    void SplashScreen.hide();
    handOverLaunchSnapshot();
  }, [isReady, shellCachesRead, homeRowsPending, waitEnded]);

  return null;
}

interface AppProps {
  readonly launchSurface?: string;
}

export default function App({ launchSurface }: AppProps) {
  const madohomu = launchSurface === MADOHOMU_LAUNCH_SURFACE;
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <CloudAuthProvider>
        <AppearancePreferencesProvider>
          <AndroidTaskSurfaceContext.Provider
            value={hasAndroidTaskRouting ? (madohomu ? "madohomu" : "main") : null}
          >
            <AppContent madohomu={madohomu} />
          </AndroidTaskSurfaceContext.Provider>
        </AppearancePreferencesProvider>
      </CloudAuthProvider>
    </RegistryContext.Provider>
  );
}

// Android's MadoHomu task keeps its own stack when the main task navigates.
function MadoHomuNavigation({ theme }: { theme: ReturnType<typeof useMobileNavigationTheme> }) {
  const { environments, isReady } = useMadoHomuEnvironmentStates();
  const wanted = madohomuLauncherWanted(environments, isReady);
  const destination = useMadoHomuEnvironments()[0]?.environmentId;
  const [lastDestination, setLastDestination] = useState(destination);
  if (destination && destination !== lastDestination) setLastDestination(destination);
  // Keep the current task through a disconnect, then retarget only its root when settings return.
  const environmentId = destination ?? lastDestination;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- updates the launcher root without resetting open routes
  useEffect(() => {
    if (environmentId && wanted !== false) syncMadoHomuLauncherDestination(environmentId);
  }, [environmentId, wanted]);
  if (wanted === false || !environmentId) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-screen px-6">
        <Text className="text-lg font-semibold text-foreground">MadoHomu</Text>
        <Text className="text-center text-base text-foreground-muted">
          {wanted === false
            ? "Enable MadoHomu in HomuCode Settings to use it."
            : "Waiting for a connection to your MadoHomu environment."}
        </Text>
      </View>
    );
  }
  return (
    <Navigation
      ref={attachLauncherRoot}
      initialState={{
        routes: [{ name: "MadoHomu", params: { environmentId } }],
      }}
      onReady={() => {
        syncMadoHomuLauncherDestination(environmentId);
        settleLaunchSplashHomeRows();
        pruneMountedDrafts();
        flushRootNavigationQueue();
      }}
      theme={theme}
      onStateChange={(state) => {
        settleLaunchSplashHomeRows();
        pruneMountedDrafts(taskNavigationState("main"), state);
      }}
    />
  );
}

function AppContent({ madohomu }: { readonly madohomu: boolean }) {
  const { themeAppearance } = useAppearancePreferences();
  const navigationTheme = useMobileNavigationTheme();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- matches the Android navigation bar to the app theme, as StatusBar does for the status bar
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void requireNativeModule<{ setNavigationBarStyle(light: boolean): Promise<void> }>(
      "T3NativeControls",
    ).setNavigationBarStyle(themeAppearance === "light");
  }, [themeAppearance]);

  return (
    <>
      <SplashScreenCoordinator />
      <MadoHomuLauncherSync />
      {madohomu ? null : (
        <>
          <SubscriptionUsageCoordinator />
          <ConnectDeviceApprovalCoordinator />
        </>
      )}
      <GestureHandlerRootView className="flex-1" onStartShouldSetResponderCapture={touchesHeld}>
        <KeyboardProvider statusBarTranslucent>
          <SafeAreaProvider>
            <StatusBar barStyle={themeAppearance === "dark" ? "light-content" : "dark-content"} />
            {/* native-stack needs the theme's dark flag to select dark native headers. */}
            <GlobalVoiceInputControl>
              <NativeLayoutMetricsProvider>
                {madohomu ? (
                  <MadoHomuNavigation theme={navigationTheme} />
                ) : (
                  <Navigation
                    ref={attachMainRoot}
                    linking={appLinking}
                    onReady={handleNavigationReady}
                    theme={navigationTheme}
                    onStateChange={handleNavigationStateChange}
                  />
                )}
                <Dialog.Host />
                <ThreadArrangementHost />
                <ProjectChipIconRasterizer />
              </NativeLayoutMetricsProvider>
            </GlobalVoiceInputControl>
            <OverlayPortalHost />
          </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </>
  );
}
