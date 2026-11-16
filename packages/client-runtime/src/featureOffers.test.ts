import { expect, it } from "vitest";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { FEATURE_OFFERS, featureOfferSettingsPatch, unseenFeatureOffers } from "./featureOffers.ts";

it("marks every displayed offer seen while applying only opt-ins and preserving future offers", () => {
  const settings = { ...DEFAULT_SERVER_SETTINGS, featureOffersSeen: ["previous-feature"] };
  const offered = FEATURE_OFFERS.slice(0, 2);
  const declined = featureOfferSettingsPatch(settings, offered, new Set());
  expect(declined).toEqual({ featureOffersSeen: ["previous-feature", "duet", "autoreview"] });
  expect(unseenFeatureOffers({ ...settings, ...declined }).map((offer) => offer.id)).toEqual([
    "quick-model",
  ]);
  expect(featureOfferSettingsPatch(settings, offered, new Set(["duet"]))).toMatchObject({
    duetEnabled: true,
  });
  expect(
    featureOfferSettingsPatch(settings, FEATURE_OFFERS, new Set(["quick-model"])),
  ).not.toHaveProperty("quickModelSelection");
});
