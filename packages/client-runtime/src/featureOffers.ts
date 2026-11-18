import type { ServerSettings } from "@t3tools/contracts";

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
      "A focused Chat and Tasks view for one project, with its own desktop app and an optional morning brief.",
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
      "When you steer Claude while it's running a tool, Claude reads your message only after the tool finishes. If you press Stop first, the message is normally lost. With this on, T3 sends it again for you.",
    setting: "claudeSteersSurviveStop",
  },
  {
    id: "reask-after-restart",
    page: 2,
    title: "Ask again after a restart",
    description:
      "When T3 Code restarts while a thread waits on an approval, question or secret, the thread resumes and asks again instead of staying stopped.",
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
    title: "Set up building T3 Code",
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
