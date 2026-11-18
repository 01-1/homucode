import { AsyncResult } from "effect/reactivity";
import {
  mobilePreferencesAtom,
  updateMobilePreferencesAtom,
  mobileSettingsSyncEnabledAtom,
} from "../../state/preferences";
import { MobileBuildTools, MobileThisDeviceName } from "../settings/SetupBehaviorSettings";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  enabledFeatureOffers,
  selectedFeatureOffers,
  featureOfferPages,
  featureOfferSettingsPatch,
  unseenFeatureOffers,
} from "@t3tools/client-runtime/feature-offers";
import {
  AuthSettingsWriteScope,
  AuthAccessWriteScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { STRAY_TOUCH_GUARD_MS, useHoldTouchesOnAppear } from "../../lib/strayTouchGuard";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { coverHomeForLaunchSnapshot } from "../home/home-launch-snapshot";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

export function FeatureOffersSheet({ active }: { readonly active: boolean }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  const { environments } = useEnvironments();
  const writable = useEnvironmentsWithScope(environments, AuthSettingsWriteScope);
  const accessWritable = useEnvironmentsWithScope(environments, AuthAccessWriteScope);
  const environment = environments.find(
    (candidate) =>
      writable.has(candidate.environmentId) &&
      candidate.connection.phase === "connected" &&
      candidate.serverConfig !== null &&
      preferences !== null &&
      unseenFeatureOffers(
        candidate.serverConfig.settings,
        "mobile",
        preferences.featureOffersSeen,
      ).filter(
        (offer) =>
          offer.setting !== "connectDeviceLongSessions" ||
          accessWritable.has(candidate.environmentId),
      ).length > 0,
  );
  return active && environment ? (
    <EnvironmentFeatureOffers
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  ) : null;
}

function EnvironmentFeatureOffers({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useEnvironmentServerConfig(environmentId);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canSetLongSessions = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: { connectDeviceLongSessions: true },
    }),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const settingsSyncEnabled = useAtomValue(mobileSettingsSyncEnabledAtom);
  const draft =
    preferences.featureOffersDraft?.environmentId === environmentId
      ? preferences.featureOffersDraft
      : undefined;
  const [chosen, setSelected] = useState<ReadonlySet<string> | null>(() =>
    draft ? new Set(draft.selected) : null,
  );
  const [savedStep, setStep] = useState(draft?.step ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [presentation] = useState(() => Symbol("feature offers"));
  useHoldTouchesOnAppear(presentation);
  const pending = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a tap outside dismisses the native sheet, which the root touch hold cannot see
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), STRAY_TOUCH_GUARD_MS);
    return () => clearTimeout(timer);
  }, []);
  const settings = config?.settings;
  const selected =
    chosen ??
    (settings
      ? selectedFeatureOffers(settings, { ...preferences, settingsSyncEnabled })
      : new Set<string>());
  const offers = settings
    ? unseenFeatureOffers(settings, "mobile", preferences.featureOffersSeen).filter(
        (offer) => offer.setting !== "connectDeviceLongSessions" || canSetLongSessions,
      )
    : [];
  const pages = featureOfferPages(offers);
  const enabled = settings ? enabledFeatureOffers(settings) : new Set<string>();
  const includes = (id: string) => offers.some((offer) => offer.id === id) && selected.has(id);
  const followups = [
    ...(includes("sent-from") ? ["device-name"] : []),
    ...(includes("building-t3") ? ["building-t3"] : []),
  ];
  const step = Math.max(0, Math.min(savedStep, pages.length + followups.length - 1));
  const followup = followups[step - pages.length];
  const last = step === pages.length + followups.length - 1;
  const save = async (apply: boolean) => {
    if (pending.current || !settings) return;
    pending.current = true;
    setBusy(true);
    const patch = featureOfferSettingsPatch(settings, offers, selected);
    const settingsPatch = apply ? patch : { featureOffersSeen: patch.featureOffersSeen };
    const preferencesPatch = {
      featureOffersSeen: [
        ...new Set([
          ...(preferences.featureOffersSeen ?? []),
          ...offers.filter((offer) => offer.platform === "mobile").map((offer) => offer.id),
        ]),
      ],
      featureOffersDraft: null,
      ...(apply && offers.some((offer) => offer.id === "settings-sync")
        ? { settingsSyncEnabled: selected.has("settings-sync") }
        : {}),
      ...(apply && offers.some((offer) => offer.id === "faster-phone-launch")
        ? { fasterPhoneLaunch: selected.has("faster-phone-launch") }
        : {}),
    };
    try {
      const result = await update({
        environmentId,
        input: { patch: settingsPatch },
      });
      if (result._tag === "Success") savePreferences(preferencesPatch);
    } catch {
      setError("Could not save HomuCode features. Try again.");
    }
    pending.current = false;
    setBusy(false);
  };
  const offered = settings !== undefined && canWrite && offers.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the Android launch picture, taken outside React, that this sheet is drawn over Home
  useEffect(() => (offered ? coverHomeForLaunchSnapshot() : undefined), [offered]);
  if (!settings || !canWrite || offers.length === 0) return null;
  const title =
    followup === "building-t3"
      ? "Building T3"
      : followup === "device-name"
        ? "Name this device"
        : pages[step]?.[0]?.page === 2
          ? "Extra features"
          : "HomuCode features";
  // Saved on the phone: a dropped connection closes this sheet, and reopening it restores them.
  const keep = (next: { readonly selected: ReadonlySet<string>; readonly step: number }) =>
    savePreferences({
      featureOffersDraft: { environmentId, selected: [...next.selected], step: next.step },
    });
  const select = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
    keep({ selected: next, step });
  };
  const goTo = (next: number) => {
    setStep(next);
    keep({ selected, step: next });
  };
  return (
    <Sheet title={title} onClose={() => void save(false)} dismissDisabled={busy || !settled}>
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-12"
      >
        <Text className="text-base text-foreground-muted">
          You can change these choices in Settings.
        </Text>
        {error ? <Text>{error}</Text> : null}
        {step < pages.length ? (
          pages[step]?.map((offer, index, pageOffers) => {
            const options =
              offer.id === "subagents"
                ? ["T3 delegation (delegate_task)", "Provider native subagents"]
                : offer.id === "thread-only-stop"
                  ? ["Only the current thread", "Current thread and its subagents"]
                  : null;
            return (
              <View key={offer.id} className="gap-2">
                {offer.page === 2 && index > 0 && pageOffers[index - 1]?.page === 1 ? (
                  <View className="border-t border-border pt-4">
                    <Text className="text-lg">Extra features</Text>
                  </View>
                ) : null}
                {options ? (
                  <>
                    <Text>{offer.title}</Text>
                    <ListChoiceRow
                      label={options[0]!}
                      description={offer.description}
                      selected={selected.has(offer.id)}
                      disabled={busy}
                      onPress={() => select(offer.id, true)}
                    />
                    <ListChoiceRow
                      label={options[1]!}
                      selected={!selected.has(offer.id)}
                      disabled={busy}
                      onPress={() => select(offer.id, false)}
                    />
                  </>
                ) : (
                  <SettingsSwitchRow
                    label={offer.title}
                    subtitle={offer.description}
                    value={selected.has(offer.id) || enabled.has(offer.id)}
                    disabled={busy || enabled.has(offer.id)}
                    onValueChange={(value) => select(offer.id, value)}
                  />
                )}
              </View>
            );
          })
        ) : followup === "device-name" ? (
          <MobileThisDeviceName />
        ) : (
          <MobileBuildTools environmentId={environmentId} />
        )}
        <View className="gap-2">
          <Button
            label={last ? "Save" : "Next"}
            tone="primary"
            fullWidth
            loading={busy}
            onPress={() => {
              if (last) void save(true);
              else goTo(step + 1);
            }}
          />
          {step > 0 ? (
            <Button label="Back" fullWidth disabled={busy} onPress={() => goTo(step - 1)} />
          ) : null}
          <Button
            label="Not now"
            tone="text"
            fullWidth
            disabled={busy}
            onPress={() => void save(false)}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}
