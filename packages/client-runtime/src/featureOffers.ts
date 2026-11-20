import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";
import {
  isManagedSettingPath,
  managedCapabilityDenial,
  type ExecutionEnvironmentDescriptor,
  type ManagedPolicySummary,
  type ServerSettings,
} from "@t3tools/contracts";

type OfferSetting =
  | "preferNativeSubagents"
  | "bareStopWaitEnabled"
  | "claudeSteersSurviveStop"
  | "reaskPendingRequestsAfterRestart"
  | "applyModelChangeNow"
  | "messageSentFromEnabled"
  | "threadTitleIncludeProjectName"
  | "stopThreadSubagents"
  | "threadTitleIdPrefix"
  | "backgroundGitEnabled"
  | "autoUpdateWhenIdle"
  | "buildToolsSettingsVisible"
  | "connectDeviceLongSessions"
  | "claudeHoldBackgroundCommands"
  | "statusLineEnabled";

export interface FeatureOffer {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly page: 1 | 2;
  readonly setting?: OfferSetting;
  readonly enabledValue?: boolean;
  readonly platform?: "mobile";
}

export const FEATURE_OFFERS: ReadonlyArray<FeatureOffer> = [
  {
    id: "madohomu",
    page: 1,
    title: "MadoHomu",
    description: msg(
      "A focused view for one project with your threads in sections, its own desktop app and an optional morning brief.",
    ),
  },
  {
    id: "quick-model",
    page: 1,
    title: msg("Quick model"),
    description: msg("Pick the model a /q message runs one quick turn on."),
  },
  {
    id: "settings-sync",
    page: 1,
    title: msg("Settings sync"),
    description: msg(
      "Keep this device's theme, chat and other settings in sync through your server.",
    ),
  },
  {
    id: "status-line",
    page: 1,
    title: msg("Status line"),
    description: msg("Show a line with model, context and usage information."),
    setting: "statusLineEnabled",
  },
  {
    id: "subagents",
    page: 2,
    title: msg("Subagents"),
    description: msg("Choose how agents delegate work."),
    setting: "preferNativeSubagents",
    enabledValue: false,
  },
  {
    id: "bare-stop-wait",
    page: 2,
    title: msg("Stop or wait jumps the queue"),
    description: msg(
      "A message containing only stop or wait stops the running turn and goes first in the queue.",
    ),
    setting: "bareStopWaitEnabled",
  },
  {
    id: "claude-steer-recovery",
    page: 2,
    title: msg("Resend unread steers after Stop"),
    description: msg(
      "When you steer Claude while it's running a tool, Claude reads your message only after the tool finishes. If you press Stop first, the message is normally lost. With this on, Homu sends it again for you.",
    ),
    setting: "claudeSteersSurviveStop",
  },
  {
    id: "reask-after-restart",
    page: 2,
    title: msg("Ask again after a restart"),
    description: msg(
      "When HomuCode restarts while a thread waits on an approval, question or secret, the thread resumes and asks again instead of staying stopped.",
    ),
    setting: "reaskPendingRequestsAfterRestart",
  },
  {
    id: "apply-model-change-now",
    page: 2,
    title: msg("Apply model and effort changes now"),
    description: msg(
      "Changing a working thread's model or effort restarts its turn on the new setting, and it carries on without a new message. Codex loses most of its prompt cache when effort changes.",
    ),
    setting: "applyModelChangeNow",
  },
  {
    id: "faster-phone-launch",
    page: 2,
    platform: "mobile",
    title: msg("Faster phone launch"),
    description: msg(
      "Connect to T3 Connect machines using the last signed-in account before sign-in loads.",
    ),
  },
  {
    id: "sent-from",
    page: 2,
    title: msg("Tell agents who sent each message"),
    description: msg(
      "End every message an agent receives with a [T3] line: a human and their device, or what sent an automatic message.",
    ),
    setting: "messageSentFromEnabled",
  },
  {
    id: "project-in-title",
    page: 2,
    title: msg("Project name in thread titles"),
    description: msg("Include the project name when generating thread titles."),
    setting: "threadTitleIncludeProjectName",
  },
  {
    id: "title-id-prefix",
    page: 2,
    title: msg("Thread title ID prefix"),
    description: msg("Include a short thread ID in generated titles."),
    setting: "threadTitleIdPrefix",
  },
  {
    id: "thread-only-stop",
    page: 2,
    title: msg("Stop behavior"),
    description: msg("Shift-click, background Stop and /stopall also stop subagents."),
    setting: "stopThreadSubagents",
    enabledValue: false,
  },
  {
    id: "background-git",
    page: 2,
    title: msg("Background Git"),
    description: msg(
      "Refresh Git status and fetch in the background. Restart to apply; T3CODE_BACKGROUND_GIT overrides this choice.",
    ),
    setting: "backgroundGitEnabled",
  },
  {
    id: "auto-update-when-idle",
    page: 2,
    title: msg("Update when agents are idle"),
    description: msg(
      "Install app updates once this machine's agents and keyboard and mouse have been idle for five minutes, and each provider's updates once its own agents have.",
    ),
    setting: "autoUpdateWhenIdle",
  },
  {
    id: "building-t3",
    page: 2,
    title: msg("Set up building HomuCode"),
    description: msg(
      "Configure cloud builds, Android APK builds and loading AppImages on the next page.",
    ),
    setting: "buildToolsSettingsVisible",
  },
  {
    id: "connect-long-sessions",
    page: 2,
    setting: "connectDeviceLongSessions",
    title: msg("Stay signed in for 30 days"),
    description: msg(
      "T3 Connect devices reconnect without a cloud round trip. Revoke a device in Settings → Sharing & access to cut it off.",
    ),
  },
  {
    id: "claude-hold-background-commands",
    page: 2,
    setting: "claudeHoldBackgroundCommands",
    title: msg("Keep Claude threads working during background commands"),
    description: msg(
      "A Claude thread stays Working while a command it started in the background is still running, unless the agent releases it. A dev server left running keeps the thread Waiting until it ends.",
    ),
  },
];

// The tagged 0.1.10 HomuCode builds introduced these patch fields separately.
const LEGACY_SETUP_INTRODUCED: Partial<Record<keyof ServerSettings, number>> = {
  applyModelChangeNow: 36,
  madohomuEnabled: 37,
  autoUpdateWhenIdle: 52,
  reaskPendingRequestsAfterRestart: 53,
};

type HomuSetupEnvironment = Pick<ExecutionEnvironmentDescriptor, "serverVersion" | "capabilities">;

function homuUnavailableReason(
  environment: HomuSetupEnvironment | null | undefined,
  resolve: MFunctionType,
): string {
  if (!environment) return resolve(msg("Waiting for server information."));
  if (/-homu\./.test(environment.serverVersion)) {
    return resolve(
      msg("HomuCode {version} lacks support for this feature. Update the server to use it.", {
        version: environment.serverVersion,
      }),
    );
  }
  return resolve(msg("This server does not support this HomuCode feature."));
}

export function getBuildToolsUnavailableReason(
  environment: HomuSetupEnvironment | null | undefined,
  canWrite?: boolean,
  resolve: MFunctionType = mFallback,
): string | null {
  const legacyRelease = legacyHomuRelease(environment?.serverVersion);
  if (!(environment?.capabilities.buildTools ?? legacyRelease >= 32)) {
    return homuUnavailableReason(environment, resolve);
  }
  return canWrite === false
    ? resolve(msg("This connection is read-only for build settings."))
    : null;
}

function legacyHomuRelease(version: string | undefined): number {
  const release = Number(version?.match(/^v?0\.1\.10-homu\.(\d+)$/)?.[1] ?? 0);
  return release <= 98 ? release : 0;
}

interface HomuSetupPermissions {
  readonly canWrite?: boolean;
  readonly canWriteAccess?: boolean;
  readonly canRunBuildTools?: boolean;
  readonly managedPolicy?: ManagedPolicySummary | undefined;
}

function managedHomuSettingReason(
  policy: ManagedPolicySummary | undefined,
  setting: keyof ServerSettings,
  resolve: MFunctionType,
): string | null {
  return policy && isManagedSettingPath(policy, setting)
    ? resolve(msg("{organization} manages this setting.", { organization: policy.organization }))
    : null;
}

export function getHomuSettingUnavailableReason(
  environment: HomuSetupEnvironment | null | undefined,
  setting: keyof ServerSettings,
  permissions: HomuSetupPermissions = {},
  resolve: MFunctionType = mFallback,
): string | null {
  const supported =
    environment?.capabilities.homuSetup ??
    legacyHomuRelease(environment?.serverVersion) >= (LEGACY_SETUP_INTRODUCED[setting] ?? 32);
  if (!supported || (setting === "statusLineEnabled" && !environment?.capabilities.statusLine)) {
    return homuUnavailableReason(environment, resolve);
  }
  if (setting === "buildToolsSettingsVisible") {
    const reason = getBuildToolsUnavailableReason(environment, permissions.canWrite, resolve);
    if (reason) return reason;
  }
  if (permissions.canWrite === false)
    return resolve(msg("This connection is read-only for server settings."));
  const managed = managedHomuSettingReason(permissions.managedPolicy, setting, resolve);
  if (managed) return managed;
  if (setting === "connectDeviceLongSessions") {
    return (
      managedCapabilityDenial(permissions.managedPolicy, "connect") ??
      (permissions.canWriteAccess === false
        ? resolve(msg("This connection cannot change access settings."))
        : null)
    );
  }
  return null;
}

/** Every server advertising homuSetup includes sync, as do tagged builds since homu.3. */
export function supportsHomuSettingsSync(environment: HomuSetupEnvironment): boolean {
  return environment.capabilities.homuSetup ?? legacyHomuRelease(environment.serverVersion) >= 3;
}

export function getHomuSetupSupport(
  environment: HomuSetupEnvironment | null | undefined,
  permissions: HomuSetupPermissions = {},
  resolve: MFunctionType = mFallback,
): {
  readonly supportedFeatureIds: ReadonlySet<string>;
  readonly unavailableFeatureReasons: ReadonlyMap<string, string>;
  readonly buildToolsUnavailableReason: string | null;
  readonly featureOffersSeenUnavailableReason: string | null;
} {
  const buildStatusReason = getBuildToolsUnavailableReason(
    environment,
    permissions.canWrite,
    resolve,
  );
  const supportedFeatureIds = new Set<string>();
  const unavailableFeatureReasons = new Map<string, string>();
  for (const offer of FEATURE_OFFERS) {
    if (offer.id === "faster-phone-launch" || offer.id === "settings-sync") {
      supportedFeatureIds.add(offer.id);
      continue;
    }
    const setting =
      offer.setting ?? (offer.id === "madohomu" ? "madohomuEnabled" : "quickModelSelection");
    const reason = getHomuSettingUnavailableReason(environment, setting, permissions, resolve);
    if (reason) unavailableFeatureReasons.set(offer.id, reason);
    else supportedFeatureIds.add(offer.id);
  }
  return {
    supportedFeatureIds,
    unavailableFeatureReasons,
    featureOffersSeenUnavailableReason: managedHomuSettingReason(
      permissions.managedPolicy,
      "featureOffersSeen",
      resolve,
    ),
    buildToolsUnavailableReason:
      buildStatusReason ??
      (permissions.canRunBuildTools === false
        ? resolve(msg("This connection cannot run build tools."))
        : null),
  };
}

export function unseenFeatureOffers(
  settings: Pick<ServerSettings, "featureOffersSeen">,
  platform: "web" | "mobile" = "web",
  deviceSeen: ReadonlyArray<string> = [],
): ReadonlyArray<FeatureOffer> {
  const seen = new Set(settings.featureOffersSeen);
  const localSeen = new Set(deviceSeen);
  return FEATURE_OFFERS.filter(
    (offer) =>
      !(offer.platform === "mobile" ? localSeen : seen).has(offer.id) &&
      (!offer.platform || offer.platform === platform),
  );
}

/** An update with either short list uses one page, omitting empty sections. */
export function featureOfferPages(
  offers: ReadonlyArray<FeatureOffer>,
): ReadonlyArray<ReadonlyArray<FeatureOffer>> {
  const first = offers.filter((offer) => offer.page === 1);
  const extra = offers.filter((offer) => offer.page === 2);
  return first.length < 3 || extra.length < 3
    ? offers.length === 0
      ? []
      : [[...first, ...extra]]
    : [first, extra];
}

function enabledFeatureOffers(
  settings: Pick<ServerSettings, "madohomuEnabled" | "quickModelSelection">,
): ReadonlySet<string> {
  return new Set([
    ...(settings.madohomuEnabled ? ["madohomu"] : []),
    ...(settings.quickModelSelection ? ["quick-model"] : []),
  ]);
}

export function selectedFeatureOffers(
  settings: ServerSettings,
  local: { readonly settingsSyncEnabled?: boolean; readonly fasterPhoneLaunch?: boolean } = {},
): ReadonlySet<string> {
  return new Set([
    ...enabledFeatureOffers(settings),
    ...FEATURE_OFFERS.filter(
      (offer) => offer.setting && settings[offer.setting] === (offer.enabledValue ?? true),
    ).map((offer) => offer.id),
    ...(local.settingsSyncEnabled ? ["settings-sync"] : []),
    ...(local.fasterPhoneLaunch ? ["faster-phone-launch"] : []),
  ]);
}

export function featureOfferSettingsPatch(
  settings: Pick<
    ServerSettings,
    "featureOffersSeen" | "defaultModelSelection" | "madohomuEnabled" | "quickModelSelection"
  >,
  offered: ReadonlyArray<FeatureOffer>,
  selected: ReadonlySet<string>,
) {
  const booleanPatch: Partial<Record<OfferSetting, boolean>> = {};
  for (const offer of offered) {
    if (offer.setting)
      booleanPatch[offer.setting] = selected.has(offer.id)
        ? (offer.enabledValue ?? true)
        : !(offer.enabledValue ?? true);
  }
  const offers = (id: string) => offered.some((offer) => offer.id === id);
  const madohomu = offers("madohomu") ? selected.has("madohomu") : settings.madohomuEnabled;
  const quick = offers("quick-model") ? selected.has("quick-model") : null;
  return {
    ...booleanPatch,
    featureOffersSeen: [
      ...new Set([
        ...settings.featureOffersSeen,
        ...offered.filter((offer) => !offer.platform).map((offer) => offer.id),
      ]),
    ],
    ...(madohomu !== settings.madohomuEnabled ? { madohomuEnabled: madohomu } : {}),
    ...(quick === true && !settings.quickModelSelection && settings.defaultModelSelection
      ? { quickModelSelection: settings.defaultModelSelection }
      : {}),
    ...(quick === false && settings.quickModelSelection ? { quickModelSelection: null } : {}),
  };
}

/** A server whose setup already ran, to start another server's choices from. */
export interface FeatureOfferSource {
  readonly label: string;
  readonly settings: ServerSettings;
}

/**
 * Choices to start from: a server's own answers for offers it has seen, then answers another
 * server already gave, then defaults. `sourceLabel` names that other server when it filled any.
 */
export function prefilledFeatureOffers(
  settings: ServerSettings,
  local: { readonly settingsSyncEnabled?: boolean; readonly fasterPhoneLaunch?: boolean },
  sources: ReadonlyArray<FeatureOfferSource>,
): { readonly selected: ReadonlySet<string>; readonly sourceLabel: string | null } {
  const own = selectedFeatureOffers(settings, local);
  const seen = new Set(settings.featureOffersSeen);
  const source = sources
    .filter((candidate) => candidate.settings.featureOffersSeen.some((id) => !seen.has(id)))
    .reduce<FeatureOfferSource | undefined>(
      (best, candidate) =>
        best &&
        best.settings.featureOffersSeen.length >= candidate.settings.featureOffersSeen.length
          ? best
          : candidate,
      undefined,
    );
  if (!source) return { selected: own, sourceLabel: null };
  const theirs = selectedFeatureOffers(source.settings, local);
  const sourceSeen = new Set(source.settings.featureOffersSeen);
  const selected = new Set<string>();
  let copied = false;
  for (const offer of FEATURE_OFFERS) {
    const fromSource =
      !offer.platform &&
      offer.id !== "settings-sync" &&
      !seen.has(offer.id) &&
      sourceSeen.has(offer.id);
    copied ||= fromSource;
    if ((fromSource ? theirs : own).has(offer.id)) selected.add(offer.id);
  }
  return { selected, sourceLabel: copied ? source.label : null };
}

/** Choices saved on a device for a server that was offline, sent once it connects. */
export interface PendingFeatureOfferSave {
  readonly selected: ReadonlyArray<string>;
  readonly offered: ReadonlyArray<string>;
}

export function pendingFeatureOfferPatch(
  settings: ServerSettings,
  support: ReturnType<typeof getHomuSetupSupport>,
  save: PendingFeatureOfferSave,
) {
  const offers = FEATURE_OFFERS.filter(
    (offer) =>
      save.offered.includes(offer.id) &&
      support.supportedFeatureIds.has(offer.id) &&
      !offer.platform &&
      offer.id !== "settings-sync",
  );
  if (offers.length === 0) return null;
  const { featureOffersSeen, ...patch } = featureOfferSettingsPatch(
    settings,
    offers,
    new Set(save.selected),
  );
  return support.featureOffersSeenUnavailableReason ? patch : { ...patch, featureOffersSeen };
}
