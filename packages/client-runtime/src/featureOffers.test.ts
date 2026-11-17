import { expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import {
  FEATURE_OFFERS,
  featureOfferSettingsPatch,
  unseenFeatureOffers,
  featureOfferPages,
} from "./featureOffers.ts";

it("marks every displayed offer seen while applying only opt-ins and preserving future offers", () => {
  const settings = { ...DEFAULT_SERVER_SETTINGS, featureOffersSeen: ["previous-feature"] };
  const offered = FEATURE_OFFERS.slice(0, 2);
  const declined = featureOfferSettingsPatch(settings, offered, new Set());
  expect(declined).toEqual({ featureOffersSeen: ["previous-feature", "duet", "autoreview"] });
  expect(unseenFeatureOffers({ ...settings, ...declined }).map((offer) => offer.id)).toEqual(
    FEATURE_OFFERS.slice(2)
      .filter((offer) => !offer.platform)
      .map((offer) => offer.id),
  );
  expect(featureOfferSettingsPatch(settings, offered, new Set(["duet"]))).toMatchObject({
    duetEnabled: true,
  });
  expect(
    featureOfferSettingsPatch(settings, FEATURE_OFFERS, new Set(["quick-model"])),
  ).not.toHaveProperty("quickModelSelection");
  const phoneOffer = FEATURE_OFFERS.filter((offer) => offer.platform === "mobile");
  expect(unseenFeatureOffers({ featureOffersSeen: ["faster-phone-launch"] }, "mobile")).toEqual(
    expect.arrayContaining(phoneOffer),
  );
  expect(unseenFeatureOffers(settings, "mobile", ["faster-phone-launch"])).not.toEqual(
    expect.arrayContaining(phoneOffer),
  );
  expect(featureOfferSettingsPatch(settings, phoneOffer, new Set()).featureOffersSeen).toEqual(
    settings.featureOffersSeen,
  );
  expect(unseenFeatureOffers(settings).some((offer) => offer.id === "connect-long-sessions")).toBe(
    true,
  );
  const connect = FEATURE_OFFERS.filter((offer) => offer.id === "connect-long-sessions");
  expect(
    featureOfferSettingsPatch(settings, connect, new Set(["connect-long-sessions"])),
  ).toMatchObject({
    connectDeviceLongSessions: true,
  });
  expect(
    unseenFeatureOffers(settings).some((offer) => offer.id === "claude-hold-background-commands"),
  ).toBe(true);
  const claude = FEATURE_OFFERS.filter((offer) => offer.id === "claude-hold-background-commands");
  expect(
    featureOfferSettingsPatch(settings, claude, new Set(["claude-hold-background-commands"])),
  ).toMatchObject({ claudeHoldBackgroundCommands: true });
});

it.each([
  [0, 0, 0],
  [0, 5, 1],
  [4, 0, 1],
  [2, 5, 1],
  [5, 2, 1],
  [3, 3, 2],
])("groups %s optional and %s extra offers into %s pages", (first, extra, pages) => {
  const offers = [
    ...Array.from({ length: first }, (_, index) => ({
      id: `first-${index}`,
      page: 1 as const,
      title: "",
      description: "",
    })),
    ...Array.from({ length: extra }, (_, index) => ({
      id: `extra-${index}`,
      page: 2 as const,
      title: "",
      description: "",
    })),
  ];
  const grouped = featureOfferPages(offers);
  expect(grouped).toHaveLength(pages);
  expect(grouped.flat()).toEqual(offers);
});
