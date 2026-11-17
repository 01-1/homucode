import {
  createNavigationContainerRef,
  type NavigationAction,
  type NavigationContainerRef,
} from "@react-navigation/native";

/**
 * The app's single navigation container. Work that outlives a screen (a draft
 * route's branch checkout, notification taps, quick actions, Connect
 * onboarding) navigates through it instead of mounting hooks in the navigator.
 */
export const rootNavigationRef = createNavigationContainerRef<ReactNavigation.RootParamList>();

/**
 * Ref callback for the container. Android activity replacement mounts the new
 * root before the old one unmounts, so the old container must not clear the
 * ref the new one already owns.
 */
export function attachRootNavigation(
  navigation: NavigationContainerRef<ReactNavigation.RootParamList> | null,
): () => void {
  if (navigation) attachedContainers.push(navigation);
  rootNavigationRef.current = navigation;
  return () => {
    const index = attachedContainers.lastIndexOf(navigation!);
    if (index !== -1) attachedContainers.splice(index, 1);
    if (rootNavigationRef.current === navigation) {
      rootNavigationRef.current = attachedContainers.at(-1) ?? null;
    }
  };
}

// Android's MadoHomu launcher task mounts a second root; the ref follows the foreground one.
const attachedContainers: Array<NavigationContainerRef<ReactNavigation.RootParamList>> = [];

export function focusRootNavigation(
  navigation: NavigationContainerRef<ReactNavigation.RootParamList> | null,
): void {
  if (navigation === null || attachedContainers.includes(navigation)) {
    rootNavigationRef.current = navigation;
    flushRootNavigationQueue();
  }
}

const pendingUntilReady: Array<() => void> = [];

/** Runs `navigate` now if the container is ready, otherwise once it becomes ready. */
export function whenRootNavigationReady(navigate: () => void): void {
  if (rootNavigationRef.isReady()) {
    navigate();
    return;
  }
  pendingUntilReady.push(navigate);
}

/** Wired to the container's `onReady`. */
export function flushRootNavigationQueue(): void {
  if (!rootNavigationRef.isReady()) return;
  for (const navigate of pendingUntilReady.splice(0)) {
    try {
      navigate();
    } catch (error) {
      console.error("[navigation] queued navigation failed", error);
    }
  }
}

/**
 * `useLinkTo` for app services that live outside the navigator: the same
 * leading-'/' guard, then the href's action dispatched at the root once ready.
 */
export function linkToRootPath(href: string, toAction: (href: string) => NavigationAction): void {
  if (!href.startsWith("/")) throw new Error(`The href must start with '/' (${href}).`);
  whenRootNavigationReady(() => {
    rootNavigationRef.dispatch({
      target: rootNavigationRef.getRootState()?.key,
      ...toAction(href),
    });
  });
}

/** False for a screen in the backgrounded task while Android's MadoHomu task has a second root. */
export function isInForegroundRoot(navigation: {
  getParent(): unknown;
  getState(): { key: string } | undefined;
}): boolean {
  let top = navigation;
  while (top.getParent()) top = top.getParent() as typeof navigation;
  return (
    !rootNavigationRef.isReady() || top.getState()?.key === rootNavigationRef.getRootState()?.key
  );
}
