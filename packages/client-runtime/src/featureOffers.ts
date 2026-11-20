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
    description:
      "A focused view for one project with your threads in sections, its own desktop app and an optional morning brief.",
  },
  {
    id: "quick-model",
    page: 1,
    title: "Quick model",
    description: "Pick the model a /q message runs one quick turn on.",
  },
  {
    id: "settings-sync",
    page: 1,
    title: "Settings sync",
    description: "Keep this device's theme, chat and other settings in sync through your server.",
  },
  {
    id: "status-line",
    page: 1,
    title: "Status line",
    description: "Show a line with model, context and usage information.",
    setting: "statusLineEnabled",
  },
  {
    id: "subagents",
    page: 2,
    title: "Subagents",
    description: "Choose how agents delegate work.",
    setting: "preferNativeSubagents",
    enabledValue: false,
  },
  {
    id: "bare-stop-wait",
    page: 2,
    title: "Stop or wait jumps the queue",
    description:
      "A message containing only stop or wait stops the running turn and goes first in the queue.",
    setting: "bareStopWaitEnabled",
  },
  {
    id: "claude-steer-recovery",
    page: 2,
    title: "Resend unread steers after Stop",
    description:
      "When you steer Claude while it's running a tool, Claude reads your message only after the tool finishes. If you press Stop first, the message is normally lost. With this on, Homu sends it again for you.",
    setting: "claudeSteersSurviveStop",
  },
  {
    id: "reask-after-restart",
    page: 2,
    title: "Ask again after a restart",
    description:
      "When HomuCode restarts while a thread waits on an approval, question or secret, the thread resumes and asks again instead of staying stopped.",
    setting: "reaskPendingRequestsAfterRestart",
  },
  {
    id: "apply-model-change-now",
    page: 2,
    title: "Apply model and effort changes now",
    description:
      "Changing a working thread's model or effort restarts its turn on the new setting, and it carries on without a new message. Codex loses most of its prompt cache when effort changes.",
    setting: "applyModelChangeNow",
  },
  {
    id: "faster-phone-launch",
    page: 2,
    platform: "mobile",
    title: "Faster phone launch",
    description:
      "Connect to T3 Connect machines using the last signed-in account before sign-in loads.",
  },
  {
    id: "sent-from",
    page: 2,
    title: "Tell agents who sent each message",
    description:
      "End every message an agent receives with a [T3] line: a human and their device, or what sent an automatic message.",
    setting: "messageSentFromEnabled",
  },
  {
    id: "project-in-title",
    page: 2,
    title: "Project name in thread titles",
    description: "Include the project name when generating thread titles.",
    setting: "threadTitleIncludeProjectName",
  },
  {
    id: "title-id-prefix",
    page: 2,
    title: "Thread title ID prefix",
    description: "Include a short thread ID in generated titles.",
    setting: "threadTitleIdPrefix",
  },
  {
    id: "thread-only-stop",
    page: 2,
    title: "Stop behavior",
    description: "Shift-click, background Stop and /stopall also stop subagents.",
    setting: "stopThreadSubagents",
    enabledValue: false,
  },
  {
    id: "background-git",
    page: 2,
    title: "Background Git",
    description:
      "Refresh Git status and fetch in the background. Restart to apply; T3CODE_BACKGROUND_GIT overrides this choice.",
    setting: "backgroundGitEnabled",
  },
  {
    id: "auto-update-when-idle",
    page: 2,
    title: "Update when agents are idle",
    description:
      "Install app updates once this machine's agents and keyboard and mouse have been idle for five minutes, and each provider's updates once its own agents have.",
    setting: "autoUpdateWhenIdle",
  },
  {
    id: "building-t3",
    page: 2,
    title: "Set up building HomuCode",
    description:
      "Configure cloud builds, Android APK builds and loading AppImages on the next page.",
    setting: "buildToolsSettingsVisible",
  },
  {
    id: "connect-long-sessions",
    page: 2,
    setting: "connectDeviceLongSessions",
    title: "Stay signed in for 30 days",
    description:
      "T3 Connect devices reconnect without a cloud round trip. Revoke a device in Settings → Sharing & access to cut it off.",
  },
  {
    id: "claude-hold-background-commands",
    page: 2,
    setting: "claudeHoldBackgroundCommands",
    title: "Keep Claude threads working during background commands",
    description:
      "A Claude thread stays Working while a command it started in the background is still running, unless the agent releases it. A dev server left running keeps the thread Waiting until it ends.",
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

function homuUnavailableReason(environment: HomuSetupEnvironment | null | undefined): string {
  if (!environment) return "Waiting for server information.";
  if (/-homu\./.test(environment.serverVersion)) {
    return `HomuCode ${environment.serverVersion} lacks support for this feature. Update the server to use it.`;
  }
  return "This server does not support this HomuCode feature.";
}

export function getBuildToolsUnavailableReason(
  environment: HomuSetupEnvironment | null | undefined,
  canWrite?: boolean,
): string | null {
  const legacyRelease = legacyHomuRelease(environment?.serverVersion);
  if (!(environment?.capabilities.buildTools ?? legacyRelease >= 32)) {
    return homuUnavailableReason(environment);
  }
  return canWrite === false ? "This connection is read-only for build settings." : null;
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
): string | null {
  return policy && isManagedSettingPath(policy, setting)
    ? `${policy.organization} manages this setting.`
    : null;
}

export function getHomuSettingUnavailableReason(
  environment: HomuSetupEnvironment | null | undefined,
  setting: keyof ServerSettings,
  permissions: HomuSetupPermissions = {},
): string | null {
  const supported =
    environment?.capabilities.homuSetup ??
    legacyHomuRelease(environment?.serverVersion) >= (LEGACY_SETUP_INTRODUCED[setting] ?? 32);
  if (!supported || (setting === "statusLineEnabled" && !environment?.capabilities.statusLine)) {
    return homuUnavailableReason(environment);
  }
  if (setting === "buildToolsSettingsVisible") {
    const reason = getBuildToolsUnavailableReason(environment, permissions.canWrite);
    if (reason) return reason;
  }
  if (permissions.canWrite === false) return "This connection is read-only for server settings.";
  const managed = managedHomuSettingReason(permissions.managedPolicy, setting);
  if (managed) return managed;
  if (setting === "connectDeviceLongSessions") {
    return (
      managedCapabilityDenial(permissions.managedPolicy, "connect") ??
      (permissions.canWriteAccess === false
        ? "This connection cannot change access settings."
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
): {
  readonly supportedFeatureIds: ReadonlySet<string>;
  readonly unavailableFeatureReasons: ReadonlyMap<string, string>;
  readonly buildToolsUnavailableReason: string | null;
  readonly featureOffersSeenUnavailableReason: string | null;
} {
  const buildStatusReason = getBuildToolsUnavailableReason(environment, permissions.canWrite);
  const supportedFeatureIds = new Set<string>();
  const unavailableFeatureReasons = new Map<string, string>();
  for (const offer of FEATURE_OFFERS) {
    if (offer.id === "faster-phone-launch" || offer.id === "settings-sync") {
      supportedFeatureIds.add(offer.id);
      continue;
    }
    const setting =
      offer.setting ?? (offer.id === "madohomu" ? "madohomuEnabled" : "quickModelSelection");
    const reason = getHomuSettingUnavailableReason(environment, setting, permissions);
    if (reason) unavailableFeatureReasons.set(offer.id, reason);
    else supportedFeatureIds.add(offer.id);
  }
  return {
    supportedFeatureIds,
    unavailableFeatureReasons,
    featureOffersSeenUnavailableReason: managedHomuSettingReason(
      permissions.managedPolicy,
      "featureOffersSeen",
    ),
    buildToolsUnavailableReason:
      buildStatusReason ??
      (permissions.canRunBuildTools === false ? "This connection cannot run build tools." : null),
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

export function enabledFeatureOffers(
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
  settings: Pick<ServerSettings, "featureOffersSeen" | "defaultModelSelection">,
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
  return {
    ...booleanPatch,
    featureOffersSeen: [
      ...new Set([
        ...settings.featureOffersSeen,
        ...offered.filter((offer) => !offer.platform).map((offer) => offer.id),
      ]),
    ],
    ...(offered.some((offer) => offer.id === "madohomu") && selected.has("madohomu")
      ? { madohomuEnabled: true }
      : {}),
    ...(offered.some((offer) => offer.id === "quick-model") &&
    selected.has("quick-model") &&
    settings.defaultModelSelection
      ? { quickModelSelection: settings.defaultModelSelection }
      : {}),
  };
}
