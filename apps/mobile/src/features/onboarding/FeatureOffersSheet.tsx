import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  MobileBuildTools,
  MobileDeviceNames,
  MobileWorkAssistancePicker,
} from "../settings/SetupBehaviorSettings";
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
  type ServerSettings,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
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
  const [chosen, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [step, setStep] = useState(0);
  const [chosenTarget, setWorkTarget] = useState<
    ServerSettings["workAssistanceTarget"] | undefined
  >();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const settings = config?.settings;
  const selected =
    chosen ?? (settings ? selectedFeatureOffers(settings, preferences) : new Set<string>());
  const workTarget =
    chosenTarget === undefined ? (settings?.workAssistanceTarget ?? null) : chosenTarget;
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
    ...(includes("work-assistance") ? ["work-assistance"] : []),
    ...(includes("building-t3") ? ["building-t3"] : []),
  ];
  const followup = followups[step - pages.length];
  const last = step === pages.length + followups.length - 1;
  const save = async (apply: boolean) => {
    if (pending.current || !settings) return;
    pending.current = true;
    setBusy(true);
    const patch = featureOfferSettingsPatch(settings, offers, selected);
    const settingsPatch = apply
      ? {
          ...patch,
          ...(includes("work-assistance") ? { workAssistanceTarget: workTarget } : {}),
        }
      : { featureOffersSeen: patch.featureOffersSeen };
    const preferencesPatch = {
      featureOffersSeen: [
        ...new Set([
          ...(preferences.featureOffersSeen ?? []),
          ...offers.filter((offer) => offer.platform === "mobile").map((offer) => offer.id),
        ]),
      ],
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
      setError("Could not save optional features. Try again.");
    }
    pending.current = false;
    setBusy(false);
  };
  if (!settings || !canWrite || offers.length === 0) return null;
  const title =
    followup === "building-t3"
      ? "Building T3"
      : followup === "device-name"
        ? "Name this device"
        : followup === "work-assistance"
          ? "Work assistance"
          : pages[step]?.[0]?.page === 2
            ? "Extra features"
            : "Optional features";
  const select = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current ?? selected);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Sheet title={title} onClose={() => void save(false)} dismissDisabled={busy}>
      <ScrollView
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
        ) : followup === "work-assistance" ? (
          <MobileWorkAssistancePicker
            environmentId={environmentId}
            value={workTarget}
            onChange={setWorkTarget}
          />
        ) : followup === "device-name" ? (
          <MobileDeviceNames environmentId={environmentId} currentOnly />
        ) : (
          <MobileBuildTools environmentId={environmentId} />
        )}
        <View className="gap-2">
          <Button
            label={last ? "Save" : "Next"}
            tone="primary"
            fullWidth
            loading={busy}
            disabled={followup === "work-assistance" && workTarget === null}
            onPress={() => {
              if (last) void save(true);
              else setStep(step + 1);
            }}
          />
          {step > 0 ? (
            <Button label="Back" fullWidth disabled={busy} onPress={() => setStep(step - 1)} />
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
