import { AsyncResult } from "effect/reactivity";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  mobilePreferencesAtom,
  persistedMobilePreferencesAtom,
  updateMobilePreferencesAtom,
  mobileSettingsSyncEnabledAtom,
} from "../../state/preferences";
import { MobileBuildTools, MobileThisDeviceName } from "../settings/SetupBehaviorSettings";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  enabledFeatureOffers,
  FEATURE_OFFERS,
  getHomuSetupSupport,
  selectedFeatureOffers,
  featureOfferPages,
  featureOfferSettingsPatch,
  unseenFeatureOffers,
  type FeatureOffer,
} from "@t3tools/client-runtime/feature-offers";
import {
  AuthSettingsWriteScope,
  AuthAccessWriteScope,
  AuthEnvironmentMaintainScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { STRAY_TOUCH_GUARD_MS, useHoldTouchesOnAppear } from "../../lib/strayTouchGuard";
import { AppState, TextInput, View } from "react-native";
import { resolveCustomSnooze } from "@t3tools/client-runtime/state/thread-settled";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import type { FeatureOffersDraft } from "../../persistence/mobile-preferences";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { coverHomeForLaunchSnapshot } from "../home/home-launch-snapshot";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

export function FeatureOffersSheet({ active }: { readonly active: boolean }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  const persisted = useAtomValue(persistedMobilePreferencesAtom);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [now, setNow] = useState(Date.now);
  const snoozedUntil = Math.max(
    dismissedUntil,
    AsyncResult.isSuccess(persisted)
      ? Date.parse(persisted.value.featureOffersSnoozedUntil ?? "") || 0
      : 0,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- wakes the native sheet after its persisted snooze expires, including while the app was backgrounded
  useEffect(() => {
    if (!Number.isFinite(snoozedUntil) || snoozedUntil <= now) return;
    const wake = () => setNow(Date.now());
    const timer = setTimeout(wake, Math.min(Math.max(0, snoozedUntil - Date.now()), 2_147_483_647));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") wake();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [now, snoozedUntil]);
  const { environments } = useEnvironments();
  const writable = useEnvironmentsWithScope(environments, AuthSettingsWriteScope);
  const accessWritable = useEnvironmentsWithScope(environments, AuthAccessWriteScope);
  const buildWritable = useEnvironmentsWithScope(environments, AuthEnvironmentMaintainScope);
  const targets = environments.map((environment) => {
    const connected = environment.connection.phase === "connected";
    const support = getHomuSetupSupport(environment.serverConfig?.environment, {
      canWrite: connected && writable.has(environment.environmentId),
      canWriteAccess: connected && accessWritable.has(environment.environmentId),
      canRunBuildTools: connected && buildWritable.has(environment.environmentId),
      managedPolicy: environment.serverConfig?.managedPolicy,
    });
    const pending = unseenFeatureOffers(
      environment.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      "mobile",
      preferences?.featureOffersSeen,
    ).filter(
      (offer) =>
        !(offer.id === "settings-sync" && preferences?.featureOffersSeen?.includes(offer.id)),
    );
    return {
      environment,
      support,
      pending: pending.length > 0,
      remotePending: pending.some(
        (offer) =>
          support.supportedFeatureIds.has(offer.id) &&
          offer.platform !== "mobile" &&
          offer.id !== "settings-sync",
      ),
    };
  });
  const target =
    targets.find((target) => target.environment.environmentId === selectedEnvironmentId) ??
    targets.find(
      (target) =>
        target.environment.environmentId === preferences?.featureOffersDraft?.environmentId,
    ) ??
    targets.find((target) => target.remotePending) ??
    targets.find((target) => target.pending);
  return active && preferences !== null && snoozedUntil <= now && target ? (
    <EnvironmentFeatureOffers
      key={target.environment.environmentId}
      environmentId={target.environment.environmentId}
      support={target.support}
      targets={targets}
      onEnvironmentChange={setSelectedEnvironmentId}
      onDismiss={(until) => setDismissedUntil(until ? Date.parse(until) : Infinity)}
    />
  ) : null;
}

function EnvironmentFeatureOffers({
  environmentId,
  support,
  targets,
  onEnvironmentChange,
  onDismiss,
}: {
  readonly environmentId: EnvironmentId;
  readonly support: ReturnType<typeof getHomuSetupSupport>;
  readonly targets: ReadonlyArray<FeatureOffersTarget>;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
  readonly onDismiss: (until?: string) => void;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promiseExit" });
  const settingsSyncEnabled = useAtomValue(mobileSettingsSyncEnabledAtom);
  const draft =
    preferences.featureOffersDrafts?.[environmentId] ??
    (preferences.featureOffersDraft?.environmentId === environmentId
      ? preferences.featureOffersDraft
      : undefined);
  const [chosen, setSelected] = useState<ReadonlySet<string> | null>(() =>
    draft ? new Set(draft.selected) : null,
  );
  const [attemptOffers, setAttemptOffers] = useState<ReadonlyArray<FeatureOffer> | null>(() =>
    draft?.offered ? FEATURE_OFFERS.filter((offer) => draft.offered?.includes(offer.id)) : null,
  );
  const pendingPhoneSave = useRef<Parameters<typeof savePreferences>[0] | null>(null);
  const savedServerOffers = useRef<ReadonlyArray<string>>(draft?.savedServerOffers ?? []);
  const pendingServerOffers = useRef<ReadonlyArray<string>>(draft?.pendingServerOffers ?? []);
  const [savedPage, setPage] = useState<string | number>(draft?.page ?? draft?.step ?? 0);
  const [sheetGeneration, setSheetGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [settled, setSettled] = useState(false);
  const [presentation] = useState(() => Symbol("feature offers"));
  useHoldTouchesOnAppear(presentation);
  const pending = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a tap outside dismisses the native sheet, which the root touch hold cannot see
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), STRAY_TOUCH_GUARD_MS);
    return () => clearTimeout(timer);
  }, []);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const selected =
    chosen ?? selectedFeatureOffers(settings, { ...preferences, settingsSyncEnabled });
  const unseen = unseenFeatureOffers(settings, "mobile", preferences.featureOffersSeen).filter(
    (offer) => !(offer.id === "settings-sync" && preferences.featureOffersSeen?.includes(offer.id)),
  );
  const offers = attemptOffers ?? (unseen.length > 0 ? unseen : FEATURE_OFFERS);
  const available = offers.filter((offer) => support.supportedFeatureIds.has(offer.id));
  const pages = featureOfferPages(offers);
  const enabled = enabledFeatureOffers(settings);
  const includes = (id: string) => available.some((offer) => offer.id === id) && selected.has(id);
  const followups = [
    ...(includes("sent-from") ? ["device-name"] : []),
    ...(includes("building-t3") ? ["building-t3"] : []),
  ];
  const pageIds = [...pages.map((page) => `offers-${page[0]?.page}`), ...followups];
  const step =
    typeof savedPage === "number"
      ? Math.max(0, Math.min(savedPage, pageIds.length - 1))
      : Math.max(0, pageIds.indexOf(savedPage));
  const followup = followups[step - pages.length];
  const last = step === pages.length + followups.length - 1;
  const save = async () => {
    if (pending.current) return;
    onEnvironmentChange(environmentId);
    pending.current = true;
    setBusy(true);
    setError(null);
    setAttemptOffers(offers);
    if (
      !support.featureOffersSeenUnavailableReason &&
      pendingServerOffers.current.length > 0 &&
      pendingServerOffers.current.every((id) => settings.featureOffersSeen.includes(id))
    ) {
      savedServerOffers.current = [
        ...new Set([...savedServerOffers.current, ...pendingServerOffers.current]),
      ];
      pendingServerOffers.current = [];
    }
    const serverOffers = available.filter(
      (offer) =>
        offer.platform !== "mobile" &&
        offer.id !== "settings-sync" &&
        !savedServerOffers.current.includes(offer.id),
    );
    const { featureOffersSeen, ...settingsPatch } = featureOfferSettingsPatch(
      settings,
      serverOffers,
      selected,
    );
    const acknowledged = savedServerOffers.current.filter((id) =>
      support.supportedFeatureIds.has(id),
    );
    const patch = support.featureOffersSeenUnavailableReason
      ? settingsPatch
      : {
          ...settingsPatch,
          featureOffersSeen: [...new Set([...featureOffersSeen, ...acknowledged])],
        };
    const needsServerWrite =
      serverOffers.length > 0 ||
      (!support.featureOffersSeenUnavailableReason &&
        acknowledged.some((id) => !settings.featureOffersSeen.includes(id)));
    const preferencesPatch = {
      featureOffersSeen: [
        ...new Set([
          ...(preferences.featureOffersSeen ?? []),
          ...available
            .filter((offer) => offer.platform === "mobile" || offer.id === "settings-sync")
            .map((offer) => offer.id),
        ]),
      ],
      featureOffersSnoozedUntil: null,
      ...(available.some((offer) => offer.id === "settings-sync")
        ? { settingsSyncEnabled: selected.has("settings-sync") }
        : {}),
      ...(available.some((offer) => offer.id === "faster-phone-launch")
        ? { fasterPhoneLaunch: selected.has("faster-phone-launch") }
        : {}),
    };
    const phonePatch =
      pendingPhoneSave.current ??
      ({
        transform: (current) => {
          const drafts = { ...current.featureOffersDrafts };
          const remainingOffers = offers.filter(
            (offer) =>
              !support.supportedFeatureIds.has(offer.id) ||
              (support.featureOffersSeenUnavailableReason &&
                savedServerOffers.current.includes(offer.id)),
          );
          const remaining =
            remainingOffers.length > 0
              ? {
                  environmentId,
                  selected: [...selected],
                  step,
                  page: pageIds[step],
                  offered: remainingOffers.map((offer) => offer.id),
                  savedServerOffers: savedServerOffers.current,
                  pendingServerOffers: pendingServerOffers.current,
                }
              : null;
          if (remaining) drafts[environmentId] = remaining;
          else delete drafts[environmentId];
          return {
            ...preferencesPatch,
            featureOffersDrafts: drafts,
            featureOffersDraft:
              current.featureOffersDraft?.environmentId === environmentId
                ? remaining
                : (current.featureOffersDraft ?? remaining),
          };
        },
      } satisfies Parameters<typeof savePreferences>[0]);
    const attempt = await settlePromise(async () => {
      if (!pendingPhoneSave.current) {
        pendingServerOffers.current = serverOffers.map((offer) => offer.id);
        const kept = await keep({
          environmentId,
          selected: [...selected],
          step,
          page: pageIds[step],
        });
        if (kept._tag === "Failure") return "Could not save choices on this phone. Try again.";
        const result = needsServerWrite ? await update({ environmentId, input: { patch } }) : null;
        if (result?._tag === "Failure") return "Could not save HomuCode features. Try again.";
        savedServerOffers.current = [
          ...new Set([...savedServerOffers.current, ...pendingServerOffers.current]),
        ];
        pendingServerOffers.current = [];
        pendingPhoneSave.current = phonePatch;
      }
      const saved = await savePreferences(phonePatch);
      return saved._tag === "Success" ? null : "Could not save choices on this phone. Try again.";
    });
    if (attempt._tag === "Success") {
      if (attempt.value === null) {
        pendingPhoneSave.current = null;
        onDismiss();
      } else setError(attempt.value);
    } else setError("Could not save HomuCode features. Try again.");
    pending.current = false;
    setBusy(false);
  };
  const offered = offers.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the Android launch picture, taken outside React, that this sheet is drawn over Home
  useEffect(() => (offered ? coverHomeForLaunchSnapshot() : undefined), [offered]);
  const title =
    followup === "building-t3"
      ? "Building Homu"
      : followup === "device-name"
        ? "Name this device"
        : pages[step]?.[0]?.page === 2
          ? "Extra features"
          : "HomuCode features";
  // Saved on the phone: a dropped connection closes this sheet, and reopening it restores them.
  const keep = (next: FeatureOffersDraft, until?: string | null) => {
    const nextDraft = {
      ...next,
      offered: offers.map((offer) => offer.id),
      savedServerOffers: savedServerOffers.current,
      pendingServerOffers: pendingServerOffers.current,
    };
    return savePreferences({
      transform: (current) => ({
        featureOffersDraft: nextDraft,
        featureOffersDrafts: {
          ...(current.featureOffersDraft
            ? { [current.featureOffersDraft.environmentId]: current.featureOffersDraft }
            : {}),
          ...current.featureOffersDrafts,
          [environmentId]: nextDraft,
        },
        ...(until === undefined ? {} : { featureOffersSnoozedUntil: until }),
      }),
    });
  };
  const select = (id: string, checked: boolean) => {
    if (selected.has(id) === checked) return;
    pendingPhoneSave.current = null;
    savedServerOffers.current = savedServerOffers.current.filter((saved) => saved !== id);
    pendingServerOffers.current = pendingServerOffers.current.filter((pending) => pending !== id);
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
    void keep({ environmentId, selected: [...next], step, page: pageIds[step] });
  };
  const goTo = (next: number) => {
    setPage(pageIds[next] ?? 0);
    void keep({ environmentId, selected: [...selected], step: next, page: pageIds[next] });
  };
  const dismiss = async (until?: string, native = false) => {
    if (pending.current) return;
    onEnvironmentChange(environmentId);
    pending.current = true;
    setBusy(true);
    setError(null);
    const result = await settlePromise(() =>
      keep({ environmentId, selected: [...selected], step, page: pageIds[step] }, until ?? null),
    );
    const saved = result._tag === "Success" && result.value._tag === "Success";
    if (saved) onDismiss(until);
    else {
      setError("Could not save choices on this phone. Try again.");
      if (native) setSheetGeneration((generation) => generation + 1);
    }
    pending.current = false;
    setBusy(false);
  };
  return (
    <Sheet
      key={sheetGeneration}
      title={snoozing ? "Snooze HomuCode features" : title}
      onClose={() => void dismiss(undefined, true)}
      dismissDisabled={busy || !settled}
    >
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-12"
      >
        {error ? <Text>{error}</Text> : null}
        {snoozing ? (
          <FeatureOffersSnooze
            disabled={busy}
            onSnooze={(until) => void dismiss(until)}
            onBack={() => setSnoozing(false)}
          />
        ) : (
          <>
            <Text className="text-base text-foreground-muted">
              You can change these choices in Settings.
            </Text>
            <FeatureOffersEnvironmentPicker
              targets={targets}
              selected={environmentId}
              disabled={busy}
              onSelect={onEnvironmentChange}
            />
            {step < pages.length ? (
              pages[step]?.map((offer, index, pageOffers) => {
                const options =
                  offer.id === "subagents"
                    ? ["Homu delegation (delegate_task)", "Provider native subagents"]
                    : offer.id === "thread-only-stop"
                      ? ["Only the current thread", "Current thread and its subagents"]
                      : null;
                const unavailable = support.unavailableFeatureReasons.get(offer.id);
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
                          description={unavailable ?? offer.description}
                          selected={selected.has(offer.id)}
                          disabled={busy || Boolean(unavailable)}
                          onPress={() => select(offer.id, true)}
                        />
                        <ListChoiceRow
                          label={options[1]!}
                          selected={!selected.has(offer.id)}
                          disabled={busy || Boolean(unavailable)}
                          onPress={() => select(offer.id, false)}
                        />
                      </>
                    ) : (
                      <SettingsSwitchRow
                        label={offer.title}
                        subtitle={unavailable ?? offer.description}
                        value={selected.has(offer.id) || enabled.has(offer.id)}
                        disabled={busy || Boolean(unavailable) || enabled.has(offer.id)}
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
                  if (last) void save();
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
                onPress={() => setSnoozing(true)}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

interface FeatureOffersTarget {
  readonly environment: EnvironmentPresentation;
  readonly support: ReturnType<typeof getHomuSetupSupport>;
}

function FeatureOffersEnvironmentPicker({
  targets,
  selected,
  disabled,
  onSelect,
}: {
  readonly targets: ReadonlyArray<FeatureOffersTarget>;
  readonly selected: EnvironmentId;
  readonly disabled: boolean;
  readonly onSelect: (environmentId: EnvironmentId) => void;
}) {
  return (
    <View className="gap-3">
      <Text className="text-sm text-foreground-muted">
        Server choices apply to the selected environment. Phone choices apply to this phone.
      </Text>
      {targets.map(({ environment, support }) => {
        const reasons = new Map<string, string[]>();
        for (const offer of FEATURE_OFFERS) {
          const reason = support.unavailableFeatureReasons.get(offer.id);
          if (reason) reasons.set(reason, [...(reasons.get(reason) ?? []), offer.title]);
        }
        return (
          <View key={environment.environmentId}>
            <ListChoiceRow
              label={environment.label}
              description={
                environment.connection.phase !== "connected"
                  ? "Disconnected. Server choices stay on this phone until it reconnects."
                  : `${support.supportedFeatureIds.size} features available`
              }
              selected={environment.environmentId === selected}
              disabled={disabled}
              onPress={() => onSelect(environment.environmentId)}
            />
            {[...reasons].map(([reason, titles]) => (
              <Text key={reason} className="text-sm text-foreground-muted">
                {reason} {titles.join(", ")}.
              </Text>
            ))}
            {support.featureOffersSeenUnavailableReason ? (
              <Text className="text-sm text-foreground-muted">
                {support.featureOffersSeenUnavailableReason}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function FeatureOffersSnooze({
  onSnooze,
  onBack,
  disabled,
}: {
  readonly onSnooze: (until?: string) => void;
  readonly onBack: () => void;
  readonly disabled: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);
  const snooze = (amount: string, unit: "minutes" | "hours" | "days") => {
    const until = resolveCustomSnooze({ mode: "duration", amount, unit }, new Date());
    if (until) onSnooze(until);
    else setError("Enter a positive duration.");
  };
  return (
    <View className="gap-4">
      <Button label="On next launch" disabled={disabled} onPress={() => onSnooze()} />
      <Button label="In 1 hour" disabled={disabled} onPress={() => snooze("1", "hours")} />
      <Button label="In 1 day" disabled={disabled} onPress={() => snooze("1", "days")} />
      <Button label="In 1 week" disabled={disabled} onPress={() => snooze("7", "days")} />
      <TextInput
        accessibilityLabel="Custom snooze duration"
        placeholder="Custom duration"
        keyboardType="decimal-pad"
        value={amount}
        editable={!disabled}
        onChangeText={setAmount}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <SegmentedControl
        variant="card"
        options={[
          { value: "minutes", label: "Minutes" },
          { value: "hours", label: "Hours" },
          { value: "days", label: "Days" },
        ]}
        selected={unit}
        onSelect={setUnit}
      />
      {error ? <Text>{error}</Text> : null}
      <Button label="Snooze" disabled={disabled} onPress={() => snooze(amount, unit)} />
      <Button label="Back" disabled={disabled} tone="text" onPress={onBack} />
    </View>
  );
}
