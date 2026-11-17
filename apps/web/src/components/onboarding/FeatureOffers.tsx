import { useAtomValue } from "@effect/atom-react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  FEATURE_OFFERS,
  enabledFeatureOffers,
  selectedFeatureOffers,
  featureOfferPages,
  featureOfferSettingsPatch,
  unseenFeatureOffers,
  type FeatureOffer,
} from "@t3tools/client-runtime/feature-offers";
import { type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import {
  useClientSettings,
  useEnvironmentSettings,
  updateClientSettings,
} from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment, environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { DeviceNamesSettings } from "../settings/BehaviorSettings";
import { BuildToolsSetup } from "../settings/BuildToolsSettings";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";

const OPTIONAL_FEATURE_OFFERS = FEATURE_OFFERS.filter((offer) => offer.page === 1);

export function FeatureOfferChoices({
  offers = OPTIONAL_FEATURE_OFFERS,
  selected,
  enabled,
  onChange,
  disabled = false,
}: {
  offers?: ReadonlyArray<FeatureOffer>;
  selected: ReadonlySet<string>;
  enabled?: ReadonlySet<string>;
  onChange: (selected: ReadonlySet<string>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4">
      {offers.map((offer, index) => {
        const select = (checked: boolean) => {
          const next = new Set(selected);
          if (checked) next.add(offer.id);
          else next.delete(offer.id);
          onChange(next);
        };
        const options =
          offer.id === "subagents"
            ? ["T3 delegation (delegate_task)", "Provider native subagents"]
            : offer.id === "thread-only-stop"
              ? ["Only the current thread", "Current thread and its subagents"]
              : null;
        return (
          <div key={offer.id}>
            {offer.page === 2 && index > 0 && offers[index - 1]?.page === 1 ? (
              <div className="mb-4 border-t pt-4">
                <h3 className="font-medium">Extra features</h3>
              </div>
            ) : null}
            {options ? (
              <div className="grid gap-2 text-sm">
                <span className="font-medium">{offer.title}</span>
                <Select
                  value={selected.has(offer.id) ? "default" : "alternative"}
                  disabled={disabled}
                  onValueChange={(value) => select(value === "default")}
                >
                  <SelectTrigger aria-label={offer.title}>
                    <SelectValue>{selected.has(offer.id) ? options[0] : options[1]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="default">{options[0]}</SelectItem>
                    <SelectItem value="alternative">{options[1]}</SelectItem>
                  </SelectPopup>
                </Select>
                <span className="text-muted-foreground">{offer.description}</span>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox
                  disabled={disabled || enabled?.has(offer.id)}
                  checked={selected.has(offer.id) || enabled?.has(offer.id) === true}
                  onCheckedChange={(checked) => select(Boolean(checked))}
                />
                <span>
                  <span className="block font-medium">{offer.title}</span>
                  <span className="text-muted-foreground">{offer.description}</span>
                </span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FeatureOffersDialog() {
  const primary = usePrimaryEnvironmentId();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const environmentId = primary ?? configs.keys().next().value ?? null;
  const completed = useClientSettings((settings) => settings.onboardingCompletedAt !== null);
  const isWelcome = useLocation({ select: (location) => location.pathname === "/welcome" });
  return environmentId && completed && !isWelcome ? (
    <EnvironmentFeatureOffers key={environmentId} environmentId={environmentId} />
  ) : null;
}

function EnvironmentFeatureOffers({ environmentId }: { environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const available = useAtomValue(serverEnvironment.settingsValueAtom(environmentId)) !== null;
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canSetLongSessions = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: { connectDeviceLongSessions: true },
    }),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const localSettings = useClientSettings();
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const selected = chosen ?? selectedFeatureOffers(settings, localSettings);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const offers = unseenFeatureOffers(settings).filter(
    (offer) => offer.setting !== "connectDeviceLongSessions" || canSetLongSessions,
  );
  const pages = featureOfferPages(offers);
  const includes = (id: string) => offers.some((offer) => offer.id === id) && selected.has(id);
  const followups = [
    ...(includes("sent-from") ? ["device-name"] : []),
    ...(includes("building-t3") ? ["building-t3"] : []),
  ];
  const followup = followups[step - pages.length];
  const last = step === pages.length + followups.length - 1;
  const save = async (apply: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const patch = featureOfferSettingsPatch(settings, offers, selected);
      const saved = await update({
        environmentId,
        input: {
          patch: apply ? patch : { featureOffersSeen: patch.featureOffersSeen },
        },
      });
      if (saved._tag === "Success" && apply && offers.some((offer) => offer.id === "settings-sync"))
        await updateClientSettings({ settingsSyncEnabled: selected.has("settings-sync") });
    } catch {
      toastManager.add({ type: "error", title: "Could not save HomuCode features" });
    }
    setBusy(false);
  };
  if (!available || !canWrite || offers.length === 0) return null;
  const title =
    followup === "building-t3"
      ? "Building T3"
      : followup === "device-name"
        ? "Name this device"
        : pages[step]?.[0]?.page === 2
          ? "Extra features"
          : "HomuCode features";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void save(false);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>You can change these choices in Settings.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {step < pages.length ? (
            <FeatureOfferChoices
              offers={pages[step] ?? []}
              selected={selected}
              enabled={enabledFeatureOffers(settings)}
              onChange={setChosen}
              disabled={busy}
            />
          ) : followup === "device-name" ? (
            <DeviceNamesSettings environmentId={environmentId} currentOnly />
          ) : (
            <BuildToolsSetup environmentId={environmentId} />
          )}
          {selected.has("quick-model") && step < pages.length ? (
            <p className="mt-3 text-sm">
              <Link to="/settings/threads" hash="quick-model">
                Quick model settings
              </Link>
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => void save(false)}>
            Not now
          </Button>
          {step > 0 ? (
            <Button variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => {
              if (last) void save(true);
              else setStep(step + 1);
            }}
          >
            {last ? "Save" : "Next"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
