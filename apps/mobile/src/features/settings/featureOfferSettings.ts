import type { SettingsPageTarget } from "./components/settings-page-targets";

/**
 * The Settings page that holds each setup-wizard offer, so every offer can be changed later.
 * Threads offers with a setting are rows in its Extra features section.
 */
export const FEATURE_OFFER_PAGES: Readonly<Partial<Record<string, SettingsPageTarget>>> = {
  madohomu: "SettingsMadoHomu",
  "quick-model": "SettingsThreads",
  "settings-sync": "SettingsOrganization",
  "status-line": "SettingsThreads",
  subagents: "SettingsThreads",
  "bare-stop-wait": "SettingsThreads",
  "claude-steer-recovery": "SettingsThreads",
  "reask-after-restart": "SettingsThreads",
  "apply-model-change-now": "SettingsThreads",
  "faster-phone-launch": "SettingsOrganization",
  "sent-from": "SettingsThreads",
  "project-in-title": "SettingsThreads",
  "title-id-prefix": "SettingsThreads",
  "thread-only-stop": "SettingsThreads",
  "background-git": "SettingsThreads",
  "auto-update-when-idle": "SettingsThreads",
  "building-t3": "SettingsOrganization",
  "connect-long-sessions": "SettingsThreads",
  "claude-hold-background-commands": "SettingsThreads",
};
