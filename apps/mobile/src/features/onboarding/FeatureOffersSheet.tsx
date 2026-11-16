import { useAtomValue } from "@effect/atom-react";
import {
  featureOfferSettingsPatch,
  unseenFeatureOffers,
} from "@t3tools/client-runtime/feature-offers";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
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
  const { environments } = useEnvironments();
  const writable = useEnvironmentsWithScope(environments, AuthSettingsWriteScope);
  const environment = environments.find(
    (candidate) =>
      writable.has(candidate.environmentId) &&
      candidate.connection.phase === "connected" &&
      candidate.serverConfig !== null &&
      unseenFeatureOffers(candidate.serverConfig.settings).length > 0,
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
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const settings = config?.settings;
  const offers = settings ? unseenFeatureOffers(settings) : [];
  const save = async (apply: boolean) => {
    if (pending.current || !settings) return;
    pending.current = true;
    setBusy(true);
    try {
      await update({
        environmentId,
        input: { patch: featureOfferSettingsPatch(settings, offers, apply ? selected : new Set()) },
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (!settings || !canWrite || offers.length === 0) return null;
  return (
    <Sheet title="Optional features" onClose={() => void save(false)} dismissDisabled={busy}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-12"
      >
        <Text className="text-base text-foreground-muted">
          Choose what to turn on. You can change these in Settings.
        </Text>
        {offers.map((offer) => (
          <SettingsSwitchRow
            key={offer.id}
            label={offer.title}
            subtitle={offer.description}
            value={selected.has(offer.id)}
            disabled={busy}
            onValueChange={(enabled) =>
              setSelected((current) => {
                const next = new Set(current);
                if (enabled) next.add(offer.id);
                else next.delete(offer.id);
                return next;
              })
            }
          />
        ))}
        {selected.has("quick-model") ? (
          <Text className="text-sm text-foreground-muted">
            Uses your environment's default model.
          </Text>
        ) : null}
        <View className="gap-2">
          <Button
            label="Save"
            tone="primary"
            fullWidth
            loading={busy}
            onPress={() => void save(true)}
          />
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
