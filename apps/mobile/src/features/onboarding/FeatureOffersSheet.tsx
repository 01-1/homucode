import { msg, T, useGT, useMessages } from "gt-react-native";
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
import { SelectionRow } from "../../components/ui/SelectionRow";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  FEATURE_OFFERS,
  getHomuSetupSupport,
  pendingFeatureOfferPatch,
  prefilledFeatureOffers,
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
import type { FeatureOffersDraft, Preferences } from "../../persistence/mobile-preferences";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { coverHomeForLaunchSnapshot } from "../home/home-launch-snapshot";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

export function FeatureOffersSheet({ active }: { readonly active: boolean }) {
  const resolve = useMessages();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  const persisted = useAtomValue(persistedMobilePreferencesAtom);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [chosenEnvironmentIds, setChosenEnvironmentIds] =
    useState<ReadonlyArray<EnvironmentId> | null>(null);
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
    const support = getHomuSetupSupport(
      environment.serverConfig?.environment,
      {
        canWrite: connected && writable.has(environment.environmentId),
        canWriteAccess: connected && accessWritable.has(environment.environmentId),
        canRunBuildTools: connected && buildWritable.has(environment.environmentId),
        managedPolicy: environment.serverConfig?.managedPolicy,
      },
      resolve,
    );
    const pending = unseenFeatureOffers(
      environment.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      "mobile",
      preferences?.featureOffersSeen,
    ).filter(
      (offer) =>
        support.supportedFeatureIds.has(offer.id) &&
        !(offer.id === "settings-sync" && preferences?.featureOffersSeen?.includes(offer.id)),
    );
    return {
      environment,
      support,
      offlineSupport: connected
        ? support
        : getHomuSetupSupport(
            environment.serverConfig?.environment,
            {
              managedPolicy: environment.serverConfig?.managedPolicy,
            },
            resolve,
          ),
      pending: pending.length > 0,
      remotePending: pending.some(
        (offer) => offer.platform !== "mobile" && offer.id !== "settings-sync",
      ),
    };
  });
  const draft = preferences?.featureOffersDraft;
  const fallback =
    targets.find(
      (target) =>
        target.environment.environmentId === draft?.environmentId &&
        (draft.offered?.some((id) => target.support.supportedFeatureIds.has(id)) ?? true),
    ) ??
    targets.find((target) => target.remotePending) ??
    targets.find((target) => target.pending);
  const fallbackId = fallback?.environment.environmentId;
  const fallbackDraft = fallbackId
    ? (preferences?.featureOffersDrafts?.[fallbackId] ??
      (draft?.environmentId === fallbackId ? draft : undefined))
    : undefined;
  // In the order chosen; the first stays primary while others connect or drop.
  const environmentIds = (
    chosenEnvironmentIds ??
    fallbackDraft?.environmentIds ??
    (fallbackId ? [fallbackId] : [])
  ).flatMap((id) => {
    const match = targets.find((target) => target.environment.environmentId === id);
    return match ? [match.environment.environmentId] : [];
  });
  const target =
    targets.find((target) => target.environment.environmentId === environmentIds[0]) ?? fallback;
  usePendingFeatureOfferSaves(targets, writable, preferences?.featureOffersPendingSaves);
  return active &&
    preferences !== null &&
    snoozedUntil <= now &&
    target &&
    (fallback || chosenEnvironmentIds) ? (
    <EnvironmentFeatureOffers
      key={target.environment.environmentId}
      environmentId={target.environment.environmentId}
      support={target.support}
      targets={targets}
      environmentIds={
        environmentIds.length > 0 ? environmentIds : [target.environment.environmentId]
      }
      onEnvironmentsChange={setChosenEnvironmentIds}
      onDismiss={(until) => setDismissedUntil(until ? Date.parse(until) : Infinity)}
    />
  ) : null;
}

/** Sends choices saved for an offline server once it connects, then forgets them. */
function usePendingFeatureOfferSaves(
  targets: ReadonlyArray<FeatureOffersTarget>,
  writable: ReadonlySet<EnvironmentId>,
  pendingSaves: Preferences["featureOffersPendingSaves"],
) {
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promiseExit" });
  // The save last tried per server; a failed one waits for a reconnect or a new save.
  const attempted = useRef(new Map<string, string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes saved choices to a server when its connection comes up
  useEffect(() => {
    for (const { environment, support } of targets) {
      const environmentId = environment.environmentId;
      const save = pendingSaves?.[environmentId];
      if (environment.connection.phase !== "connected") {
        attempted.current.delete(environmentId);
        continue;
      }
      if (!save || !environment.serverConfig || !writable.has(environmentId)) continue;
      const key = JSON.stringify(save);
      if (attempted.current.get(environmentId) === key) continue;
      attempted.current.set(environmentId, key);
      const patch = pendingFeatureOfferPatch(environment.serverConfig.settings, support, save);
      void settlePromise(async () => {
        const result = patch ? await update({ environmentId, input: { patch } }) : null;
        if (result?._tag === "Failure") return;
        await savePreferences({
          transform: (current) => {
            const rest = { ...current.featureOffersPendingSaves };
            if (JSON.stringify(rest[environmentId]) === key) delete rest[environmentId];
            return { featureOffersPendingSaves: rest };
          },
        });
      });
    }
  }, [targets, writable, pendingSaves, update, savePreferences]);
}

function EnvironmentFeatureOffers({
  environmentId,
  support,
  targets,
  environmentIds,
  onEnvironmentsChange,
  onDismiss,
}: {
  readonly environmentId: EnvironmentId;
  readonly support: ReturnType<typeof getHomuSetupSupport>;
  readonly targets: ReadonlyArray<FeatureOffersTarget>;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly onEnvironmentsChange: (environmentIds: ReadonlyArray<EnvironmentId>) => void;
  readonly onDismiss: (until?: string) => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
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
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const selectedTargets = targets.filter((target) =>
    environmentIds.includes(target.environment.environmentId),
  );
  const unseenIds = new Set(
    [
      settings,
      ...selectedTargets.flatMap(({ environment }) =>
        environment.serverConfig ? [environment.serverConfig.settings] : [],
      ),
    ].flatMap((entry) =>
      unseenFeatureOffers(entry, "mobile", preferences.featureOffersSeen).map((offer) => offer.id),
    ),
  );
  const unseen = FEATURE_OFFERS.filter(
    (offer) =>
      unseenIds.has(offer.id) &&
      !(offer.id === "settings-sync" && preferences.featureOffersSeen?.includes(offer.id)),
  );
  const primaryConnected = selectedTargets.some(
    (target) =>
      target.environment.environmentId === environmentId &&
      target.environment.connection.phase === "connected",
  );
  const queuedTargets = selectedTargets.filter(
    (target) => target.environment.environmentId !== environmentId || !primaryConnected,
  );
  const prefilled = prefilledFeatureOffers(
    settings,
    { ...preferences, settingsSyncEnabled },
    targets.flatMap(({ environment }) =>
      environment.environmentId !== environmentId &&
      environment.connection.phase === "connected" &&
      environment.serverConfig
        ? [{ label: environment.label, settings: environment.serverConfig.settings }]
        : [],
    ),
  );
  const defaults = prefilled.selected;
  const savedOfferIds = draft?.offered;
  const newOffers =
    savedOfferIds && !savedOfferIds.some((id) => support.supportedFeatureIds.has(id))
      ? unseen.filter((offer) => support.supportedFeatureIds.has(offer.id))
      : [];
  const [chosen, setSelected] = useState<ReadonlySet<string> | null>(() => {
    if (!draft) return null;
    const selected = new Set(draft.selected);
    for (const offer of newOffers) {
      if (defaults.has(offer.id)) selected.add(offer.id);
      else selected.delete(offer.id);
    }
    return selected;
  });
  const [attemptOffers, setAttemptOffers] = useState<ReadonlyArray<FeatureOffer> | null>(() =>
    savedOfferIds
      ? FEATURE_OFFERS.filter(
          (offer) => savedOfferIds.includes(offer.id) || newOffers.includes(offer),
        )
      : null,
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
  const selected = chosen ?? defaults;
  const offers = attemptOffers ?? (unseen.length > 0 ? unseen : FEATURE_OFFERS);
  const available = offers.filter((offer) =>
    selectedTargets.some((target) => offerSupport(target, offer.id) !== "no"),
  );
  const pages = featureOfferPages(offers);
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
    onEnvironmentsChange(environmentIds);
    pending.current = true;
    setBusy(true);
    setError(null);
    setAttemptOffers(offers);
    setSelected(selected);
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
        support.supportedFeatureIds.has(offer.id) &&
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
    const queued = {
      selected: [...selected],
      offered: available
        .filter((offer) => offer.platform !== "mobile" && offer.id !== "settings-sync")
        .map((offer) => offer.id),
    };
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
          const pendingSaves = { ...current.featureOffersPendingSaves };
          for (const { environment } of queuedTargets) {
            pendingSaves[environment.environmentId] = queued;
            if (environment.environmentId !== environmentId)
              delete drafts[environment.environmentId];
          }
          const remainingOffers = offers.filter(
            (offer) =>
              (primaryConnected && !support.supportedFeatureIds.has(offer.id)) ||
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
                  environmentIds,
                }
              : null;
          if (remaining) drafts[environmentId] = remaining;
          else delete drafts[environmentId];
          return {
            ...preferencesPatch,
            featureOffersPendingSaves: pendingSaves,
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
        if (kept._tag === "Failure") return msg("Could not save choices on this phone. Try again.");
        const result = needsServerWrite ? await update({ environmentId, input: { patch } }) : null;
        if (result?._tag === "Failure") return msg("Could not save HomuCode features. Try again.");
        savedServerOffers.current = [
          ...new Set([...savedServerOffers.current, ...pendingServerOffers.current]),
        ];
        pendingServerOffers.current = [];
        pendingPhoneSave.current = phonePatch;
      }
      const saved = await savePreferences(phonePatch);
      return saved._tag === "Success"
        ? null
        : msg("Could not save choices on this phone. Try again.");
    });
    if (attempt._tag === "Success") {
      if (attempt.value === null) {
        pendingPhoneSave.current = null;
        onDismiss();
      } else setError(attempt.value);
    } else setError(msg("Could not save HomuCode features. Try again."));
    pending.current = false;
    setBusy(false);
  };
  const offered = offers.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the Android launch picture, taken outside React, that this sheet is drawn over Home
  useEffect(() => (offered ? coverHomeForLaunchSnapshot() : undefined), [offered]);
  const title =
    followup === "building-t3"
      ? gt("Building Homu")
      : followup === "device-name"
        ? gt("Name this device")
        : pages[step]?.[0]?.page === 2
          ? gt("Extra features")
          : gt("HomuCode features");
  // Saved on the phone: a dropped connection closes this sheet, and reopening it restores them.
  const keep = (next: FeatureOffersDraft, until?: string | null) => {
    const nextDraft = {
      ...next,
      offered: offers.map((offer) => offer.id),
      savedServerOffers: savedServerOffers.current,
      pendingServerOffers: pendingServerOffers.current,
      environmentIds,
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
  const toggleEnvironment = (id: EnvironmentId) => {
    const next = environmentIds.includes(id)
      ? environmentIds.filter((entry) => entry !== id)
      : [...environmentIds, id];
    if (next.length === 0) return;
    const primary = next[0];
    if (primary && primary !== environmentId) {
      const carried = {
        environmentId: primary,
        selected: [...selected],
        step: 0,
        environmentIds: next,
      };
      void savePreferences({
        transform: (current) => ({
          featureOffersDraft: carried,
          featureOffersDrafts: { ...current.featureOffersDrafts, [primary]: carried },
        }),
      });
    } else void keep({ environmentId, selected: [...selected], step, page: pageIds[step] });
    onEnvironmentsChange(next);
  };
  const dismiss = async (until?: string, native = false) => {
    if (pending.current) return;
    onEnvironmentsChange(environmentIds);
    pending.current = true;
    setBusy(true);
    setError(null);
    const result = await settlePromise(() =>
      keep({ environmentId, selected: [...selected], step, page: pageIds[step] }, until ?? null),
    );
    const saved = result._tag === "Success" && result.value._tag === "Success";
    if (saved) onDismiss(until);
    else {
      setError(msg("Could not save choices on this phone. Try again."));
      if (native) setSheetGeneration((generation) => generation + 1);
    }
    pending.current = false;
    setBusy(false);
  };
  return (
    <Sheet
      key={sheetGeneration}
      title={snoozing ? gt("Snooze HomuCode features") : title}
      onClose={() => void dismiss(undefined, true)}
      dismissDisabled={busy || !settled}
    >
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-12"
      >
        {error ? <Text>{resolve(error)}</Text> : null}
        {snoozing ? (
          <FeatureOffersSnooze
            disabled={busy}
            onSnooze={(until) => void dismiss(until)}
            onBack={() => setSnoozing(false)}
          />
        ) : (
          <>
            <Text className="text-base text-foreground-muted">
              <T>You can change these choices in Settings.</T>
            </Text>
            {prefilled.sourceLabel ? (
              <Text className="text-sm text-foreground-muted">
                {gt("Filled in from your choices on {source}.", { source: prefilled.sourceLabel })}
              </Text>
            ) : null}
            <FeatureOffersEnvironmentPicker
              targets={targets}
              selected={environmentIds}
              disabled={busy}
              onToggle={toggleEnvironment}
            />
            {step < pages.length ? (
              pages[step]?.map((offer, index, pageOffers) => {
                const options =
                  offer.id === "subagents"
                    ? [gt("Homu delegation (delegate_task)"), gt("Provider native subagents")]
                    : offer.id === "thread-only-stop"
                      ? [gt("Only the current thread"), gt("Current thread and its subagents")]
                      : null;
                const unavailable = available.includes(offer)
                  ? undefined
                  : (support.unavailableFeatureReasons.get(offer.id) ??
                    gt("No selected environment supports this feature."));
                const supportChips = (
                  <FeatureSupportChips offer={offer} targets={targets} selected={selectedTargets} />
                );
                return (
                  <View key={offer.id} className="gap-2">
                    {offer.page === 2 && index > 0 && pageOffers[index - 1]?.page === 1 ? (
                      <View className="border-t border-border pt-4">
                        <Text className="text-lg">
                          <T>Extra features</T>
                        </Text>
                      </View>
                    ) : null}
                    {options ? (
                      <>
                        <Text>{resolve(offer.title)}</Text>
                        <ListChoiceRow
                          label={options[0]!}
                          description={unavailable ?? resolve(offer.description)}
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
                        {supportChips}
                      </>
                    ) : (
                      <>
                        <SettingsSwitchRow
                          label={resolve(offer.title)}
                          subtitle={unavailable ?? resolve(offer.description)}
                          value={selected.has(offer.id)}
                          disabled={busy || Boolean(unavailable)}
                          onValueChange={(value) => select(offer.id, value)}
                        />
                        {supportChips}
                      </>
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
                label={last ? gt("Save") : gt("Next")}
                tone="primary"
                fullWidth
                loading={busy}
                onPress={() => {
                  if (last) void save();
                  else goTo(step + 1);
                }}
              />
              {step > 0 ? (
                <Button
                  label={gt("Back")}
                  fullWidth
                  disabled={busy}
                  onPress={() => goTo(step - 1)}
                />
              ) : null}
              <Button
                label={gt("Not now")}
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
  readonly offlineSupport: ReturnType<typeof getHomuSetupSupport>;
}

// Readable on both the light and dark sheet backgrounds.
const ENVIRONMENT_COLORS = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];

function environmentColor(
  targets: ReadonlyArray<FeatureOffersTarget>,
  environmentId: EnvironmentId,
): string {
  const index = targets.findIndex((target) => target.environment.environmentId === environmentId);
  return ENVIRONMENT_COLORS[Math.max(0, index) % ENVIRONMENT_COLORS.length]!;
}

/** "later": the server is offline and its choices are sent when it reconnects. */
function offerSupport(target: FeatureOffersTarget, offerId: string): "yes" | "no" | "later" {
  const { environment } = target;
  if (environment.connection.phase === "connected")
    return target.support.supportedFeatureIds.has(offerId) ? "yes" : "no";
  if (!environment.serverConfig) return "later";
  return target.offlineSupport.supportedFeatureIds.has(offerId) ? "later" : "no";
}

function FeatureSupportChips({
  offer,
  targets,
  selected,
}: {
  readonly offer: FeatureOffer;
  readonly targets: ReadonlyArray<FeatureOffersTarget>;
  readonly selected: ReadonlyArray<FeatureOffersTarget>;
}) {
  const gt = useGT();
  if (offer.platform === "mobile" || offer.id === "settings-sync") {
    return (
      <View className="flex-row flex-wrap gap-2 px-4">
        <Text className="text-xs text-foreground-muted">
          <T>This phone</T>
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-2 px-4">
      {selected.map((target) => {
        const { environmentId, label } = target.environment;
        const state = offerSupport(target, offer.id);
        const color = environmentColor(targets, environmentId);
        return (
          <View
            key={environmentId}
            accessible
            accessibilityLabel={
              state === "yes"
                ? gt("{label} supports this", { label })
                : state === "later"
                  ? gt("{label} gets this when it reconnects", { label })
                  : gt("{label} does not support this", { label })
            }
            className="flex-row items-center gap-1.5 rounded-full border px-2 py-0.5"
            style={{
              borderColor: state === "no" ? "transparent" : color,
              opacity: state === "no" ? 0.5 : 1,
            }}
          >
            <View
              className="size-2 rounded-full border"
              style={{
                borderColor: color,
                backgroundColor: state === "yes" ? color : "transparent",
              }}
            />
            <Text
              className="text-xs text-foreground"
              style={state === "no" ? { textDecorationLine: "line-through" } : undefined}
            >
              {state === "later" ? gt("{label} (when online)", { label }) : label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function FeatureOffersEnvironmentPicker({
  targets,
  selected,
  disabled,
  onToggle,
}: {
  readonly targets: ReadonlyArray<FeatureOffersTarget>;
  readonly selected: ReadonlyArray<EnvironmentId>;
  readonly disabled: boolean;
  readonly onToggle: (environmentId: EnvironmentId) => void;
}) {
  const gt = useGT();
  return (
    <View className="gap-3">
      <Text className="text-sm text-foreground-muted">
        <T>
          Server choices apply to every selected environment. Phone choices apply to this phone.
        </T>
      </Text>
      <View>
        {targets.map(({ environment, support }, index) => (
          <View key={environment.environmentId}>
            <SelectionRow
              role="checkbox"
              title={environment.label}
              leading={
                <View
                  className="size-3 rounded-full"
                  style={{
                    backgroundColor: environmentColor(targets, environment.environmentId),
                  }}
                />
              }
              subtitle={
                environment.connection.phase !== "connected"
                  ? gt("Offline. Choices are sent when it reconnects.")
                  : gt("{count} features available", { count: support.supportedFeatureIds.size })
              }
              selected={selected.includes(environment.environmentId)}
              disabled={disabled}
              isFirst={index === 0}
              isLast={index === targets.length - 1}
              onPress={() => onToggle(environment.environmentId)}
            />
            {support.featureOffersSeenUnavailableReason ? (
              <Text className="text-sm text-foreground-muted">
                {support.featureOffersSeenUnavailableReason}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
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
  const gt = useGT();
  const resolve = useMessages();
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);
  const snooze = (amount: string, unit: "minutes" | "hours" | "days") => {
    const until = resolveCustomSnooze({ mode: "duration", amount, unit }, new Date());
    if (until) onSnooze(until);
    else setError(msg("Enter a positive duration."));
  };
  return (
    <View className="gap-4">
      <Button label={gt("On next launch")} disabled={disabled} onPress={() => onSnooze()} />
      <Button label={gt("In 1 hour")} disabled={disabled} onPress={() => snooze("1", "hours")} />
      <Button label={gt("In 1 day")} disabled={disabled} onPress={() => snooze("1", "days")} />
      <Button label={gt("In 1 week")} disabled={disabled} onPress={() => snooze("7", "days")} />
      <TextInput
        accessibilityLabel={gt("Custom snooze duration")}
        placeholder={gt("Custom duration")}
        keyboardType="decimal-pad"
        value={amount}
        editable={!disabled}
        onChangeText={setAmount}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <SegmentedControl
        variant="card"
        options={[
          { value: "minutes", label: gt("Minutes") },
          { value: "hours", label: gt("Hours") },
          { value: "days", label: gt("Days") },
        ]}
        selected={unit}
        onSelect={setUnit}
      />
      {error ? <Text>{resolve(error)}</Text> : null}
      <Button label={gt("Snooze")} disabled={disabled} onPress={() => snooze(amount, unit)} />
      <Button label={gt("Back")} disabled={disabled} tone="text" onPress={onBack} />
    </View>
  );
}
