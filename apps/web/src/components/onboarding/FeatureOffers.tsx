import { useAtomValue } from "@effect/atom-react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  FEATURE_OFFERS,
  enabledFeatureOffers,
  featureOfferSettingsPatch,
  unseenFeatureOffers,
  type FeatureOffer,
} from "@t3tools/client-runtime/feature-offers";
import { type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment, environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
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

export function FeatureOfferChoices({
  offers = FEATURE_OFFERS,
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
      {offers.map((offer) => (
        <label key={offer.id} className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            disabled={disabled || enabled?.has(offer.id)}
            checked={selected.has(offer.id) || enabled?.has(offer.id) === true}
            onCheckedChange={(checked) => {
              const next = new Set(selected);
              if (checked) next.add(offer.id);
              else next.delete(offer.id);
              onChange(next);
            }}
          />
          <span>
            <span className="block font-medium">{offer.title}</span>
            <span className="text-muted-foreground">{offer.description}</span>
            {offer.id === "quick-model" && selected.has(offer.id) ? (
              <span className="block text-xs text-muted-foreground">
                Uses your default model. Choose another in Settings → Threads → Quick model.
              </span>
            ) : null}
          </span>
        </label>
      ))}
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
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const offers = unseenFeatureOffers(settings);
  const save = async (apply: boolean) => {
    if (busy) return;
    setBusy(true);
    await (async () => {
      await update({
        environmentId,
        input: { patch: featureOfferSettingsPatch(settings, offers, apply ? selected : new Set()) },
      });
    })().finally(() => {
      setBusy(false);
    });
  };
  if (!available || !canWrite || offers.length === 0) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void save(false);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Optional features</DialogTitle>
          <DialogDescription>
            Choose what to turn on. You can change these in Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <FeatureOfferChoices
            offers={offers}
            selected={selected}
            enabled={enabledFeatureOffers(settings)}
            onChange={setSelected}
            disabled={busy}
          />
          {selected.has("quick-model") ? (
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
          <Button disabled={busy} onClick={() => void save(true)}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
