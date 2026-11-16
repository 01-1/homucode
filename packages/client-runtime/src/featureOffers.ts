import type { ServerSettings } from "@t3tools/contracts";

/**
 * Opt-in features offered once: on the Welcome page for new users, and in a one-time prompt
 * for existing users when a build first ships them. Ids are stored in `featureOffersSeen`.
 */
export interface FeatureOffer {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const FEATURE_OFFERS: ReadonlyArray<FeatureOffer> = [
  {
    id: "duet",
    title: "Duet",
    description:
      "A focused Chat and Tasks view for one project, with its own desktop app and an optional morning brief.",
  },
  {
    id: "autoreview",
    title: "Autoreviewers",
    description: "Let agents attach reviewer subagents that check a thread's work as it happens.",
  },
  {
    id: "quick-model",
    title: "Quick model",
    description: "Pick the model a `/q` message runs one quick turn on.",
  },
];

export function unseenFeatureOffers(
  settings: Pick<ServerSettings, "featureOffersSeen">,
): ReadonlyArray<FeatureOffer> {
  const seen = new Set(settings.featureOffersSeen);
  return FEATURE_OFFERS.filter((offer) => !seen.has(offer.id));
}

export function featureOffersSeenAfter(
  settings: Pick<ServerSettings, "featureOffersSeen">,
  offered: ReadonlyArray<FeatureOffer>,
): ReadonlyArray<string> {
  return [...new Set([...settings.featureOffersSeen, ...offered.map((offer) => offer.id)])];
}
